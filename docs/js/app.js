// ========================================
// アプリケーションメイン
// ========================================

// DOM要素
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const filterLaw = document.getElementById('filterLaw');
const filterOrdinance = document.getElementById('filterOrdinance');
const searchInfo = document.getElementById('searchInfo');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultsContainer = document.getElementById('resultsContainer');
const noResults = document.getElementById('noResults');
const articleModal = document.getElementById('articleModal');
const modalClose = document.getElementById('modalClose');
const modalBody = document.getElementById('modalBody');

// 状態管理
let currentResults = { articles: [], pdfs: [] };
let searchTimeout = null;

// ========================================
// 初期化
// ========================================
async function init() {
    showLoading(true);

    const success = await searchEngine.loadData();

    if (success) {
        showLoading(false);
        displayStats();
        setupEventListeners();

        // URLパラメータから検索クエリを取得
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        if (query) {
            searchInput.value = query;
            performSearch();
        }
    } else {
        showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
    }
}

// ========================================
// イベントリスナー
// ========================================
function setupEventListeners() {
    // 検索ボタン
    searchButton.addEventListener('click', performSearch);

    // Enterキーで検索
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // リアルタイム検索（デバウンス）
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (searchInput.value.trim().length >= 2) {
                performSearch();
            }
        }, 500);
    });

    // フィルター変更
    filterLaw.addEventListener('change', performSearch);
    filterOrdinance.addEventListener('change', performSearch);

    // モーダル閉じる
    modalClose.addEventListener('click', closeModal);
    articleModal.addEventListener('click', (e) => {
        if (e.target === articleModal) {
            closeModal();
        }
    });

    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !articleModal.classList.contains('hidden')) {
            closeModal();
        }
    });
}

// ========================================
// 検索実行
// ========================================
function performSearch() {
    const query = searchInput.value.trim();

    if (query.length === 0) {
        clearResults();
        return;
    }

    const filters = {
        law: filterLaw.checked,
        ordinance: filterOrdinance.checked,
        details: true,
        appendices: true
    };

    currentResults = searchEngine.search(query, filters);
    displayResults(currentResults);

    // URLを更新（履歴に追加せず）
    const url = new URL(window.location);
    url.searchParams.set('q', query);
    window.history.replaceState({}, '', url);
}

// ========================================
// 結果表示
// ========================================
function displayResults(results) {
    resultsContainer.innerHTML = '';
    noResults.classList.add('hidden');

    const totalResults = results.articles.length + results.pdfs.length;

    if (totalResults === 0) {
        noResults.classList.remove('hidden');
        searchInfo.textContent = '検索結果: 0件';
        return;
    }

    searchInfo.textContent = `検索結果: ${totalResults}件（条文${results.articles.length}件、PDF資料${results.pdfs.length}件）`;

    // 条文結果を表示
    if (results.articles.length > 0) {
        const articleSection = document.createElement('div');
        articleSection.className = 'results-section-header';
        articleSection.innerHTML = '<h3>📜 条文</h3>';
        resultsContainer.appendChild(articleSection);

        results.articles.forEach((result, index) => {
            const card = createArticleCard(result, index);
            resultsContainer.appendChild(card);
        });
    }

    // PDF資料結果を表示
    if (results.pdfs.length > 0) {
        const pdfSection = document.createElement('div');
        pdfSection.className = 'results-section-header';
        pdfSection.innerHTML = '<h3>📄 関連資料（保安基準・細目告示・別添）</h3>';
        pdfSection.style.marginTop = '30px';
        resultsContainer.appendChild(pdfSection);

        results.pdfs.forEach((result, index) => {
            const card = createPDFCard(result, index);
            resultsContainer.appendChild(card);
        });
    }
}

function createArticleCard(result, index) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.setAttribute('data-index', index);

    const lawTypeClass = result.lawType === '法律' ? 'law' : 'ordinance';

    card.innerHTML = `
        <div class="result-header">
            <div class="result-title">
                <div class="article-number">${result.articleNumber}</div>
                <div class="article-title">${result.highlightedTitle}</div>
            </div>
            <div class="law-badge ${lawTypeClass}">${result.lawName}</div>
        </div>
        <div class="result-content">${result.highlightedContent}</div>
    `;

    card.addEventListener('click', () => showArticleDetail(result));

    return card;
}

function createPDFCard(result, index) {
    const card = document.createElement('div');
    card.className = 'result-card pdf-card';
    card.setAttribute('data-index', index);

    const typeLabels = {
        'standard': '保安基準',
        'detail': '細目告示',
        'appendix': '別添',
        'other': 'その他'
    };

    const typeLabel = typeLabels[result.type] || result.typeLabel || 'PDF';
    const typeClass = result.type;

    card.innerHTML = `
        <div class="result-header">
            <div class="result-title">
                <div class="article-number">${result.displayName || result.id}</div>
                <div class="article-title">${result.highlightedTitle}</div>
            </div>
            <div class="law-badge ${typeClass}">${typeLabel}</div>
        </div>
        <div class="result-content">
            ${result.highlightedContent || result.content || ''}
        </div>
        ${result.keywords && result.keywords.length > 0 ? `
        <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-secondary);">
            🏷️ ${result.keywords.join(', ')}
        </div>
        ` : ''}
        <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-secondary);">
            📊 全文字数: ${(result.fullTextLength || 0).toLocaleString()}文字
        </div>
        ${result.url ? `
        <div style="margin-top: 15px;">
            <a href="${result.url}" target="_blank" rel="noopener noreferrer" class="pdf-link-button" onclick="event.stopPropagation();">
                📥 PDFを開く
            </a>
        </div>
        ` : ''}
    `;

    // クリックで詳細表示
    card.addEventListener('click', () => {
        showPDFDetail(result);
    });

    return card;
}

// ========================================
// 条文詳細表示
// ========================================
function showArticleDetail(result) {
    const paragraphsHtml = result.paragraphs.map((p, i) => `
        <p><strong>第${p.paragraphNumber}項:</strong> ${p.content}</p>
    `).join('');

    modalBody.innerHTML = `
        <h2>${result.articleNumber} ${result.title}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">
            ${result.lawName}（${result.lawType}）
        </p>
        <div style="line-height: 1.8;">
            ${paragraphsHtml || `<p>${result.content}</p>`}
        </div>
    `;

    articleModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function showPDFDetail(result) {
    const typeLabels = {
        'standard': '保安基準',
        'detail': '細目告示',
        'appendix': '別添',
        'other': 'その他'
    };

    const typeLabel = typeLabels[result.type] || result.typeLabel || 'PDF資料';
    const displayName = result.displayName || result.id;

    modalBody.innerHTML = `
        <h2>${displayName} ${result.title}</h2>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">
            ${typeLabel} | 全文字数: ${(result.fullTextLength || 0).toLocaleString()}文字
        </p>
        ${result.url ? `
        <div style="margin-bottom: 20px;">
            <a href="${result.url}" target="_blank" rel="noopener noreferrer" class="pdf-link-button">
                📥 PDFを開く
            </a>
        </div>
        ` : ''}
        ${result.keywords && result.keywords.length > 0 ? `
        <div style="margin-bottom: 20px; padding: 10px; background: var(--bg-secondary); border-radius: 8px;">
            <strong>🏷️ キーワード:</strong> ${result.keywords.join(', ')}
        </div>
        ` : ''}
        <div style="line-height: 1.8; white-space: pre-wrap; max-height: 60vh; overflow-y: auto;">
            ${result.fullContent || result.content || 'テキストが利用できません'}
        </div>
    `;

    articleModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    articleModal.classList.add('hidden');
    document.body.style.overflow = '';
}

// ========================================
// UI ヘルパー
// ========================================
function showLoading(show) {
    if (show) {
        loadingIndicator.classList.remove('hidden');
        resultsContainer.classList.add('hidden');
    } else {
        loadingIndicator.classList.add('hidden');
        resultsContainer.classList.remove('hidden');
    }
}

function clearResults() {
    resultsContainer.innerHTML = '';
    searchInfo.textContent = '';
    noResults.classList.add('hidden');
}

function displayStats() {
    const stats = searchEngine.getStats();
    if (stats) {
        console.log(`📊 統計情報:`, stats);
        const totalPdfs = (stats.standardsCount || 0) + (stats.detailsCount || 0) +
            (stats.appendicesCount || 0) + (stats.otherCount || 0);
        searchInfo.textContent = `${stats.lawCount}件の法令、${stats.articleCount}条文、PDF資料${totalPdfs}件を検索できます`;
    }
}

function showError(message) {
    resultsContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
            <p style="font-size: 1.5rem; margin-bottom: 10px;">⚠️ エラー</p>
            <p>${message}</p>
        </div>
    `;
    loadingIndicator.classList.add('hidden');
}

// ========================================
// アプリケーション起動
// ========================================
document.addEventListener('DOMContentLoaded', init);
