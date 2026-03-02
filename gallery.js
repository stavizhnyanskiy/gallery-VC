
const API_URL = '/api_proxy'; // Proxy to https://api.depositphotos.com/v1/?dp_command=getMediaData

const PER_PAGE = 50;
let page = 0;
let ids = [];

const gallery = document.getElementById('gallery');
const pageLabel = document.getElementById('page');

/* ===== CSV LOADER ===== */
const BATCH_SIZE = 1000;
let currentBatch = 0;

/* ===== LOCALSTORAGE SYNC ===== */
const STORAGE_KEY = 'gallery_selected_ids';

function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
    } catch (e) { }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            JSON.parse(saved).forEach(id => selectedIds.add(String(id)));
            updateSelectionUI();
        }
    } catch (e) { }
}

async function loadCSV() {
    try {
        const res = await fetch(`ids.csv?t=${Date.now()}`);
        if (!res.ok) throw new Error(`Failed to load CSV: ${res.status} ${res.statusText}`);
        const text = await res.text();

        // Parse IDs — CSV has NO header, filter only numeric lines
        const allIds = text
            .split('\n')
            .map(row => row.split(';')[0].trim())
            .filter(s => /^\d+$/.test(s)); // only valid numeric IDs

        // Step 1: Restore from localStorage immediately (fast, no network)
        loadFromLocalStorage();

        // Step 2: Sync with Google Sheets (authoritative source, may be slow)
        try {
            const checkedRes = await fetch('/api_get_checked_ids?t=' + Date.now());
            if (checkedRes.ok) {
                const checkedText = await checkedRes.text();
                const serverIds = checkedText.split('\n').map(s => s.trim()).filter(Boolean);
                if (serverIds.length > 0 || selectedIds.size === 0) {
                    // Server returned data: use server as truth
                    selectedIds.clear();
                    serverIds.forEach(id => selectedIds.add(id));
                }
                saveToLocalStorage();
                updateSelectionUI();
            }
        } catch (e) {
            console.warn('Could not sync with Google Sheets, using localStorage backup:', e);
        }

        // Parse batch from URL
        const params = new URLSearchParams(window.location.search);
        currentBatch = parseInt(params.get('batch')) || 0;

        const start = currentBatch * BATCH_SIZE;
        const end = start + BATCH_SIZE;

        // Slice only the current batch (exactly BATCH_SIZE items, or fewer for the last batch)
        ids = allIds.slice(start, end);

        // Update UI to show current batch info
        const batchInfo = document.createElement('div');
        batchInfo.style.textAlign = 'center';
        batchInfo.style.marginBottom = '10px';
        batchInfo.innerHTML = `
            <strong>Batch: ${currentBatch}</strong> 
            (Items ${start + 1} - ${Math.min(end, allIds.length)} of ${allIds.length})
        `;
        gallery.parentElement.insertBefore(batchInfo, gallery);

        loadPage();
    } catch (err) {
        console.error(err);
        alert('Error loading CSV: ' + err.message + '\n\nIf you are opening this file directly in the browser, try using a local server because of CORS restrictions.');
        gallery.innerHTML = '<div style="color:red; text-align:center;">Error loading data. Check console for details.</div>';
    }
}

/* ===== PAGE LOADER ===== */
async function loadPage() {
    try {
        gallery.innerHTML = 'Loading...';

        const start = page * PER_PAGE;
        const slice = ids.slice(start, start + PER_PAGE);
        if (!slice.length) {
            gallery.innerHTML = 'No items found.';
            return;
        }

        // Helper to fetch single item
        const fetchItem = async (id) => {
            try {
                const body = new URLSearchParams({
                    dp_apikey: CONFIG.API_KEY,
                    dp_media_id: id,
                    dp_ignore_status: 'true'
                });

                const response = await fetch(API_URL, {
                    method: 'POST',
                    body
                });

                if (!response.ok) return { id, _failed: true };
                const data = await response.json();
                return data && !data.error ? data : { id, _failed: true };
            } catch (e) {
                console.error(`Error loading ID ${id}:`, e);
                return { id, _failed: true };
            }
        };

        // Fetch in batches of 5 to avoid overwhelming the proxy/browser
        const batchSize = 5;
        const results = [];
        for (let i = 0; i < slice.length; i += batchSize) {
            const batch = slice.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(fetchItem));
            results.push(...batchResults);
        }

        render(results);
        renderPagination();
    } catch (err) {
        console.error(err);
        gallery.innerHTML = `<div style="color:red; text-align:center;">Error loading page: ${err.message}</div>`;
    }
}

/* ===== SELECTION LOGIC ===== */
const selectedIds = new Set();
const selectionBar = document.getElementById('selectionBar');
const selectionCount = document.getElementById('selectionCount');
const copyBtn = document.getElementById('copyIds');
const clearBtn = document.getElementById('clearSelection');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');

function updateSelectionUI() {
    selectionCount.innerText = `Selected: ${selectedIds.size}`;
    if (selectedIds.size > 0) {
        selectionBar.classList.add('visible');
    } else {
        selectionBar.classList.remove('visible');
    }
}

copyBtn.onclick = () => {
    const idsStr = Array.from(selectedIds).join(',');
    navigator.clipboard.writeText(idsStr).then(() => {
        alert('Copied ' + selectedIds.size + ' IDs to clipboard!');
    });
};

clearBtn.onclick = () => {
    selectedIds.clear();
    saveToLocalStorage();
    updateSelectionUI();
    // Re-render current page to uncheck boxes
    loadPage();
};

if (selectAllCheckbox) {
    selectAllCheckbox.onchange = async (e) => {
        const isChecked = e.target.checked;
        const checkboxes = document.querySelectorAll('.item-select');
        const itemsToUpdate = [];

        checkboxes.forEach(cb => {
            if (cb.checked !== isChecked) {
                cb.checked = isChecked;
                const itemId = String(cb.dataset.id);
                if (isChecked) {
                    selectedIds.add(itemId);
                    cb.closest('.item').classList.add('selected');
                } else {
                    selectedIds.delete(itemId);
                    cb.closest('.item').classList.remove('selected');
                }
                itemsToUpdate.push(itemId);
            }
        });

        if (itemsToUpdate.length === 0) return;

        updateSelectionUI();
        saveToLocalStorage();

        // Disable checkbox while saving
        selectAllCheckbox.disabled = true;

        // Send selection updates in batches of 5 to avoid overwhelming the server
        for (let i = 0; i < itemsToUpdate.length; i += 5) {
            const batch = itemsToUpdate.slice(i, i + 5);
            await Promise.all(batch.map(id => fetch('/api_update_selection', {
                method: 'POST',
                body: JSON.stringify({ id: id, selected: isChecked })
            }).catch(err => console.error('Save to Google Sheets failed', err))));
        }

        // Restore checkbox state
        selectAllCheckbox.disabled = false;
    };
}

/* ===== HOVER PREVIEW ===== */
const hoverPreview = document.createElement('div');
Object.assign(hoverPreview.style, {
    position: 'fixed',
    zIndex: '9999',
    pointerEvents: 'none',
    opacity: '0',
    visibility: 'hidden',
    transition: 'opacity 0.15s ease-in-out',
    background: '#fff',
    padding: '8px',
    borderRadius: '8px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
});
const hoverImg = document.createElement('img');
hoverImg.style.maxHeight = '90vh';
hoverImg.style.maxWidth = '90vw';
hoverImg.style.objectFit = 'contain';
hoverImg.style.display = 'block';
hoverImg.style.borderRadius = '4px';
hoverPreview.appendChild(hoverImg);
document.body.appendChild(hoverPreview);

let hoverTimeout;

/* ===== RENDER ===== */
function render(items) {
    gallery.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item';

        // Use item.id as string for consistent comparison
        const itemId = String(item.id);
        const isSelected = selectedIds.has(itemId);
        if (isSelected) div.classList.add('selected');

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'item-select';
        checkbox.dataset.id = itemId;
        checkbox.checked = isSelected;

        // Show placeholder for failed items
        if (item._failed) {
            div.style.background = '#2a2a2a';
            div.style.minWidth = '120px';
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'padding:10px;color:#888;font-size:11px;text-align:center;';
            placeholder.innerHTML = `<div>ID: <a href="https://admin.depositphotos.com/files/view/${itemId}" target="_blank" style="color:#666">${itemId}</a></div><div>Failed to load</div>`;
            div.appendChild(checkbox);
            div.appendChild(placeholder);
            gallery.appendChild(div);
            return;
        }

        checkbox.onchange = (e) => {
            if (e.target.checked) {
                selectedIds.add(itemId);
                div.classList.add('selected');
            } else {
                selectedIds.delete(itemId);
                div.classList.remove('selected');
            }
            updateSelectionUI();
            saveToLocalStorage(); // Instant local save

            // If a checkbox was unchecked, make sure "Select all" is unchecked too
            if (selectAllCheckbox && !e.target.checked) {
                selectAllCheckbox.checked = false;
            } else if (selectAllCheckbox && e.target.checked) {
                const checkedCount = document.querySelectorAll('.item-select:checked').length;
                const totalCount = document.querySelectorAll('.item-select').length;
                if (checkedCount === totalCount && totalCount > 0) {
                    selectAllCheckbox.checked = true;
                }
            }

            // Async save to Google Sheets
            fetch('/api_update_selection', {
                method: 'POST',
                body: JSON.stringify({ id: itemId, selected: e.target.checked })
            }).catch(err => console.error('Save to Google Sheets failed', err));
        };

        div.appendChild(checkbox);

        // Content
        const content = document.createElement('div');
        content.innerHTML = `
          <img src="${item.thumb_huge || item.thumbnail}" loading="lazy">
          <div class="meta">
              <div><b>ID:</b> <a href="https://admin.depositphotos.com/files/view/${item.id}" target="_blank" style="color:#fff;text-decoration:underline;">${item.id}</a></div>
              <div><b>Status:</b> ${item.status}</div>
          </div>
        `;
        div.appendChild(content);

        // Hover events for tooltip
        div.onmouseenter = (e) => {
            hoverImg.src = item.thumb_max || item.url_big || item.thumb_huge || item.thumbnail;
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => {
                hoverPreview.style.visibility = 'visible';
                hoverPreview.style.opacity = '1';
            }, 300); // 300ms delay to prevent flashing
        };

        div.onmouseleave = () => {
            clearTimeout(hoverTimeout);
            hoverPreview.style.opacity = '0';
            hoverPreview.style.visibility = 'hidden';
        };

        div.onmousemove = (e) => {
            const popupWidth = hoverPreview.offsetWidth || 500;
            const popupHeight = hoverPreview.offsetHeight || 500;

            let x = e.clientX + 20;
            let y = e.clientY + 20;

            // Adjust if it goes off the right edge
            if (x + popupWidth > window.innerWidth) {
                x = e.clientX - popupWidth - 20;
            }

            // Adjust if it goes off the bottom edge
            if (y + popupHeight > window.innerHeight) {
                y = e.clientY - popupHeight - 20;
            }

            // Fallback adjustments if image is large and window is small
            if (x < 0) x = 10;
            if (y < 0) y = 10;

            hoverPreview.style.left = x + 'px';
            hoverPreview.style.top = y + 'px';
        };

        gallery.appendChild(div);
    });

    if (selectAllCheckbox) {
        const checkboxes = document.querySelectorAll('.item-select');
        if (checkboxes.length > 0) {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
        } else {
            selectAllCheckbox.checked = false;
        }
    }
}

/* ===== PAGINATION ===== */
function renderPagination() {
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    const totalPages = Math.ceil(ids.length / PER_PAGE);

    // Helper to create button
    const createBtn = (text, targetPage, isActive = false) => {
        const btn = document.createElement('button');
        btn.innerText = text;
        if (isActive) btn.className = 'active';
        btn.onclick = () => {
            if (targetPage !== page && targetPage >= 0 && targetPage < totalPages) {
                page = targetPage;
                loadPage();
            }
        };
        return btn;
    };

    // Prev
    container.appendChild(createBtn('←', page - 1));

    // Pages logic
    const pages = [];
    if (totalPages <= 7) {
        for (let i = 0; i < totalPages; i++) pages.push(i);
    } else {
        pages.push(0); // First
        if (page > 2) pages.push('...');

        let start = Math.max(1, page - 1);
        let end = Math.min(totalPages - 2, page + 1);

        for (let i = start; i <= end; i++) pages.push(i);

        if (page < totalPages - 3) pages.push('...');
        pages.push(totalPages - 1); // Last
    }

    pages.forEach(p => {
        if (p === '...') {
            const span = document.createElement('span');
            span.innerText = '...';
            container.appendChild(span);
        } else {
            container.appendChild(createBtn(p + 1, p, page === p));
        }
    });

    // Next
    container.appendChild(createBtn('→', page + 1));

    // Input Go To
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 1;
    input.max = totalPages;
    input.placeholder = '#';
    input.onchange = (e) => {
        const val = parseInt(e.target.value) - 1;
        if (!isNaN(val) && val >= 0 && val < totalPages) {
            page = val;
            loadPage();
        }
    };
    container.appendChild(input);
}

/* INIT */
loadCSV();