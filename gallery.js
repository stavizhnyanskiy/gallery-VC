
const API_URL = '/api_proxy'; // Proxy to https://api.depositphotos.com/v1/?dp_command=getMediaData

const PER_PAGE = 50;
let page = 0;
let ids = [];

const gallery = document.getElementById('gallery');
const pageLabel = document.getElementById('page');

/* ===== CSV LOADER ===== */
async function loadCSV() {
    try {
        const res = await fetch('ids.csv');
        if (!res.ok) throw new Error(`Failed to load CSV: ${res.status} ${res.statusText}`);
        const text = await res.text();

        ids = text
            .split('\n')
            .slice(1) // skip header
            .map(row => row.split(';')[0].trim())
            .filter(Boolean)
            .map(Number);

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

        // Create an array of promises, one for each ID
        const promises = slice.map(async (id) => {
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

                if (!response.ok) return null; // Ignore errors for individual items
                const data = await response.json();
                return data && !data.error ? data : null;
            } catch (e) {
                console.error(`Error loading ID ${id}:`, e);
                return null;
            }
        });

        // Wait for all requests to finish
        const results = await Promise.all(promises);

        // Filter out failed items
        const items = results.filter(item => item !== null);

        render(items);
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
    updateSelectionUI();
    // Re-render current page to uncheck boxes
    loadPage();
};

/* ===== RENDER ===== */
function render(items) {
    gallery.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item';

        // Check selection state
        const isSelected = selectedIds.has(item.id);
        if (isSelected) div.classList.add('selected');

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'item-select';
        checkbox.checked = isSelected;

        checkbox.onchange = (e) => {
            if (e.target.checked) {
                selectedIds.add(item.id);
                div.classList.add('selected');
            } else {
                selectedIds.delete(item.id);
                div.classList.remove('selected');
            }
            updateSelectionUI();
        };

        div.appendChild(checkbox);

        // Content
        const content = document.createElement('div');
        content.innerHTML = `
          <img src="${item.thumb_huge || item.thumbnail}" loading="lazy">
          <div><b>ID:</b> ${item.id}</div>
          <div><b>Status:</b> ${item.status}</div>
        `;
        div.appendChild(content);

        gallery.appendChild(div);
    });
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