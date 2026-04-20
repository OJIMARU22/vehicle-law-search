// ========================================
// 検索エンジン（Lunr.js 日本語対応版）
// ========================================

class SearchEngine {
    constructor() {
        this.laws = [];
        this.synonyms = {};
        this.pdfMetadata = { details: [], appendices: [] };
        this.pdfContent = { standards: [], details: [], appendices: [], other: [] };
        this.isReady = false;

        // Lunr.js インデックス
        this.articleIndex = null;
        this.pdfIndex = null;

        // IDからデータへの参照Map（Lunr検索結果→元データ）
        this.articleMap = new Map();
        this.pdfMap = new Map();
    }

    // ========================================
    // データの読み込み
    // ========================================
    async loadData() {
        try {
            const [lawsResponse, synonymsResponse, pdfMetadataResponse, pdfContentResponse] = await Promise.all([
                fetch('data/laws.json'),
                fetch('data/synonyms.json'),
                fetch('data/pdf_metadata.json'),
                fetch('data/pdf_content.json')
            ]);

            this.laws = (await lawsResponse.json()).laws;
            this.synonyms = await synonymsResponse.json();
            this.pdfMetadata = await pdfMetadataResponse.json();
            const pdfData = await pdfContentResponse.json();

            this.pdfContent = {
                standards: pdfData.standards || [],
                details: pdfData.details || [],
                appendices: pdfData.appendices || [],
                other: pdfData.other || []
            };

            console.log(`✅ データ読み込み完了: ${this.laws.length}件の法令`);

            // Lunrインデックスを構築
            this.buildIndex();

            this.isReady = true;
            return true;
        } catch (error) {
            console.error('❌ データ読み込みエラー:', error);
            return false;
        }
    }

    // ========================================
    // Lunr.js インデックス構築
    // ========================================
    buildIndex() {
        console.log('🔧 Lunrインデックスを構築中...');

        // 日本語サポートが利用可能か確認
        const useLunrJa = typeof lunr !== 'undefined' && typeof lunr.ja !== 'undefined';

        // --- 条文インデックス ---
        const articleDocs = [];
        for (const law of this.laws) {
            for (const article of law.articles) {
                const docId = `${law.lawId}__${article.articleNumber}`;
                const doc = {
                    id: docId,
                    title: article.title || '',
                    content: (article.content || '').substring(0, 2000),
                    articleNumber: article.articleNumber || '',
                    lawName: law.lawName || ''
                };
                articleDocs.push(doc);
                this.articleMap.set(docId, { law, article });
            }
        }

        this.articleIndex = lunr(function () {
            if (useLunrJa) {
                this.use(lunr.ja);
            }
            this.field('title', { boost: 10 });
            this.field('lawName', { boost: 5 });
            this.field('articleNumber', { boost: 8 });
            this.field('content');
            this.ref('id');

            for (const doc of articleDocs) {
                this.add(doc);
            }
        });

        // --- PDF インデックス ---
        const pdfDocs = [];
        const categories = [
            { data: this.pdfContent.standards, type: 'standard', label: '保安基準' },
            { data: this.pdfContent.details, type: 'detail', label: '細目告示' },
            { data: this.pdfContent.appendices, type: 'appendix', label: '別添' },
            { data: this.pdfContent.other, type: 'other', label: 'その他' }
        ];

        for (const category of categories) {
            for (const pdf of category.data) {
                const doc = {
                    id: pdf.id,
                    title: pdf.title || '',
                    content: (pdf.content || '').substring(0, 2000),
                    keywords: (pdf.keywords || []).join(' ')
                };
                pdfDocs.push(doc);
                this.pdfMap.set(pdf.id, { pdf, type: category.type, label: category.label });
            }
        }

        this.pdfIndex = lunr(function () {
            if (useLunrJa) {
                this.use(lunr.ja);
            }
            this.field('title', { boost: 10 });
            this.field('keywords', { boost: 5 });
            this.field('content');
            this.ref('id');

            for (const doc of pdfDocs) {
                this.add(doc);
            }
        });

        const totalPdfs = pdfDocs.length;
        console.log(`✅ Lunrインデックス構築完了 (日本語: ${useLunrJa ? 'ON' : 'OFF'}) — 条文${articleDocs.length}件、PDF${totalPdfs}件`);
    }

    // ========================================
    // 同義語展開
    // ========================================
    expandSynonyms(query) {
        const terms = new Set([query.toLowerCase()]);

        for (const [key, synonyms] of Object.entries(this.synonyms)) {
            const keyLower = key.toLowerCase();
            const synonymsLower = synonyms.map(s => s.toLowerCase());

            if (query.toLowerCase().includes(keyLower)) {
                terms.add(keyLower);
                synonymsLower.forEach(s => terms.add(s));
            }
            if (synonymsLower.some(s => query.toLowerCase().includes(s))) {
                terms.add(keyLower);
                synonymsLower.forEach(s => terms.add(s));
            }
        }

        return Array.from(terms);
    }

    // ========================================
    // 検索クエリのパース（AND/OR検索対応）
    // ========================================
    parseSearchQuery(query) {
        const orGroups = query.split(/\s+OR\s+/i);

        if (orGroups.length > 1) {
            const expandedGroups = orGroups.map(group => this.expandSynonyms(group.trim()));
            return {
                mode: 'OR',
                groups: expandedGroups,
                originalTerms: orGroups.map(g => g.trim())
            };
        } else {
            const andTerms = query.trim().split(/\s+/);
            const expandedTerms = andTerms.flatMap(term => this.expandSynonyms(term));
            return {
                mode: 'AND',
                terms: Array.from(new Set(expandedTerms)),
                originalTerms: andTerms
            };
        }
    }

    // ========================================
    // Lunrクエリ文字列の生成
    // ========================================
    buildLunrQuery(parsedQuery) {
        // Lunrの特殊文字をエスケープ
        const escape = (term) => term.replace(/[+\-^~*?:\\]/g, '\\$&');

        if (parsedQuery.mode === 'OR') {
            // OR: グループ内の同義語をすべてOR結合
            const allTerms = parsedQuery.groups.flat();
            return allTerms.map(t => escape(t)).join(' ');
        } else {
            // AND: 元の各単語（同義語展開済み）をOR結合したものをANDで繋ぐ
            // Lunrでは同一フィールドへの複数語はデフォルトORなので、
            // 各オリジナル語の同義語グループを+で必須化する
            const parts = parsedQuery.originalTerms.map(originalTerm => {
                const syns = this.expandSynonyms(originalTerm);
                // 複数の同義語はOR相当（+をつけず）で渡し、グループ全体を+で必須化はしない
                // ただし、1語だけの場合は+をつけて必須化
                if (syns.length === 1) {
                    return '+' + escape(syns[0]);
                }
                return syns.map(s => escape(s)).join(' ');
            });
            return parts.join(' ');
        }
    }

    // ========================================
    // テキストのハイライト
    // ========================================
    highlightText(text, terms) {
        if (!text || terms.length === 0) return text;

        let result = text;
        const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

        for (const term of sortedTerms) {
            if (term.length < 2) continue;
            const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
            result = result.replace(regex, '<span class="highlight">$1</span>');
        }

        return result;
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ========================================
    // フォールバック: includes()ベースの検索（Lunrが失敗した場合）
    // ========================================
    fallbackSearch(parsedQuery, filters) {
        const articleResults = [];

        for (const law of this.laws) {
            if (law.lawType === '法律' && !filters.law) continue;
            if (law.lawType === '省令' && !filters.ordinance) continue;

            for (const article of law.articles) {
                const content = (article.title + ' ' + article.content).toLowerCase();
                let matches = false;
                let matchedTerms = [];

                if (parsedQuery.mode === 'OR') {
                    for (const group of parsedQuery.groups) {
                        if (group.some(term => content.includes(term.toLowerCase()))) {
                            matches = true;
                            matchedTerms = matchedTerms.concat(group);
                            break;
                        }
                    }
                } else {
                    matches = parsedQuery.originalTerms.every(originalTerm => {
                        const synonyms = this.expandSynonyms(originalTerm);
                        return synonyms.some(syn => content.includes(syn.toLowerCase()));
                    });
                    if (matches) matchedTerms = parsedQuery.terms;
                }

                if (matches) {
                    let score = 0;
                    const c = content;
                    if (c.includes(parsedQuery.originalTerms[0]?.toLowerCase())) score += 150;
                    for (const term of matchedTerms) {
                        score += (c.match(new RegExp(this.escapeRegex(term.toLowerCase()), 'gi')) || []).length * 15;
                        if (article.title.toLowerCase().includes(term.toLowerCase())) score += 80;
                    }

                    articleResults.push({
                        lawId: law.lawId,
                        lawName: law.lawName,
                        lawType: law.lawType,
                        articleNumber: article.articleNumber,
                        title: article.title,
                        content: article.content,
                        paragraphs: article.paragraphs,
                        score,
                        highlightedTitle: this.highlightText(article.title, matchedTerms),
                        highlightedContent: this.highlightText(
                            article.content.substring(0, 300) + (article.content.length > 300 ? '...' : ''),
                            matchedTerms
                        )
                    });
                }
            }
        }

        articleResults.sort((a, b) => b.score - a.score);
        return articleResults;
    }

    // ========================================
    // PDF資料の検索
    // ========================================
    searchPDFs(parsedQuery) {
        const pdfResults = [];
        let lunrPdfResults = [];

        // Lunrで検索
        try {
            const lunrQuery = this.buildLunrQuery(parsedQuery);
            lunrPdfResults = this.pdfIndex.search(lunrQuery);
        } catch (e) {
            console.warn('PDF Lunr検索エラー、フォールバックへ:', e.message);
        }

        // フォールバック: Lunrが0件の場合はincludes()検索
        const allTerms = parsedQuery.mode === 'OR'
            ? parsedQuery.groups.flat()
            : parsedQuery.terms;

        if (lunrPdfResults.length === 0) {
            // includes()ベースのフォールバック
            const categories = [
                { data: this.pdfContent.standards, type: 'standard', label: '保安基準' },
                { data: this.pdfContent.details, type: 'detail', label: '細目告示' },
                { data: this.pdfContent.appendices, type: 'appendix', label: '別添' },
                { data: this.pdfContent.other, type: 'other', label: 'その他' }
            ];

            for (const category of categories) {
                for (const pdf of category.data) {
                    const searchText = (pdf.title + ' ' + pdf.content + ' ' + (pdf.keywords || []).join(' ')).toLowerCase();
                    let matches = false;
                    let matchedTerms = [];

                    if (parsedQuery.mode === 'OR') {
                        for (const group of parsedQuery.groups) {
                            if (group.some(term => searchText.includes(term.toLowerCase()))) {
                                matches = true;
                                matchedTerms = matchedTerms.concat(group);
                                break;
                            }
                        }
                    } else {
                        matches = parsedQuery.originalTerms.every(originalTerm => {
                            const synonyms = this.expandSynonyms(originalTerm);
                            return synonyms.some(syn => searchText.includes(syn.toLowerCase()));
                        });
                        if (matches) matchedTerms = parsedQuery.terms;
                    }

                    if (matches) {
                        let score = 0;
                        for (const term of matchedTerms) {
                            const termLower = term.toLowerCase();
                            score += (searchText.match(new RegExp(this.escapeRegex(termLower), 'gi')) || []).length * 10;
                            if (pdf.title.toLowerCase().includes(termLower)) score += 50;
                            if (pdf.keywords?.some(kw => kw.toLowerCase().includes(termLower))) score += 30;
                        }

                        const preview = this.makePreview(pdf.content, matchedTerms);
                        pdfResults.push(this.makePDFResult(pdf, category, matchedTerms, preview, score));
                    }
                }
            }
        } else {
            // Lunr結果を元データにマッピング
            for (const lunrResult of lunrPdfResults) {
                const entry = this.pdfMap.get(lunrResult.ref);
                if (!entry) continue;
                const { pdf, type, label } = entry;
                const preview = this.makePreview(pdf.content, allTerms);
                const score = Math.round(lunrResult.score * 100);
                pdfResults.push(this.makePDFResult(pdf, { type, label }, allTerms, preview, score));
            }
        }

        pdfResults.sort((a, b) => b.score - a.score);
        return pdfResults;
    }

    makePreview(content, terms) {
        let preview = content.substring(0, 200);
        for (const term of terms) {
            const index = content.toLowerCase().indexOf(term.toLowerCase());
            if (index !== -1 && index < 500) {
                const start = Math.max(0, index - 50);
                const end = Math.min(content.length, index + 150);
                preview = '...' + content.substring(start, end) + '...';
                break;
            }
        }
        return preview;
    }

    makePDFResult(pdf, category, matchedTerms, preview, score) {
        return {
            type: category.type,
            typeLabel: category.label,
            id: pdf.id,
            displayName: this.formatPDFDisplayName(pdf.id),
            title: pdf.title,
            content: preview,
            fullContent: pdf.content,
            keywords: pdf.keywords || [],
            fullTextLength: pdf.fullTextLength || pdf.content.length,
            score,
            highlightedTitle: this.highlightText(pdf.title, matchedTerms),
            highlightedContent: this.highlightText(preview, matchedTerms),
            url: this.getPDFUrl(pdf.id)
        };
    }

    // ========================================
    // PDFのURLを取得
    // ========================================
    getPDFUrl(pdfId) {
        if (!pdfId) return null;

        // IDのプレフィックスから国土交通省のURLを自動生成
        // 例: S001 → https://www.mlit.go.jp/jidosha/content/S001.pdf
        //     H001-2 → https://www.mlit.go.jp/jidosha/content/H001-2.pdf
        const prefix = pdfId.match(/^([A-Z])/)?.[1];
        if (prefix === 'S' || prefix === 'B' || prefix === 'H') {
            return `https://www.mlit.go.jp/jidosha/content/${pdfId}.pdf`;
        }

        // メタデータにURLがあればそちらを優先（カスタムURLが必要な場合）
        const detailMeta = this.pdfMetadata.details?.find(item => item.id === pdfId);
        if (detailMeta?.url) return detailMeta.url;

        const appendixMeta = this.pdfMetadata.appendices?.find(item => item.id === pdfId);
        if (appendixMeta?.url) return appendixMeta.url;

        return null;
    }


    // ========================================
    // PDFのIDを分かりやすい表示名に変換
    // ========================================
    formatPDFDisplayName(pdfId) {
        const match = pdfId.match(/^([A-Z])(\d+)(-\d+)?$/);
        if (!match) return pdfId;

        const prefix = match[1];
        const number = parseInt(match[2], 10);
        const suffix = match[3] || '';

        switch (prefix) {
            case 'S': return `細目告示 第${number}条${suffix}`;
            case 'B': return `別添${number}${suffix}`;
            case 'H': return `保安基準 第${number}条${suffix}`;
            default: return pdfId;
        }
    }

    // ========================================
    // メイン検索
    // ========================================
    search(query, filters = { law: true, ordinance: true, details: true, appendices: true }) {
        if (!this.isReady || !query || query.trim().length === 0) {
            return { articles: [], pdfs: [] };
        }

        const parsedQuery = this.parseSearchQuery(query.trim());
        let articleResults = [];

        // Lunrで条文検索
        let lunrArticleResults = [];
        try {
            const lunrQuery = this.buildLunrQuery(parsedQuery);
            lunrArticleResults = this.articleIndex.search(lunrQuery);
        } catch (e) {
            console.warn('条文 Lunr検索エラー、フォールバックへ:', e.message);
        }

        const allTerms = parsedQuery.mode === 'OR'
            ? parsedQuery.groups.flat()
            : parsedQuery.terms;

        if (lunrArticleResults.length === 0) {
            // フォールバック: includes()ベース
            articleResults = this.fallbackSearch(parsedQuery, filters);
            console.log(`⚠️ Lunrが0件 → フォールバック検索: ${articleResults.length}件`);
        } else {
            // Lunr結果を元データにマッピング
            for (const lunrResult of lunrArticleResults) {
                const entry = this.articleMap.get(lunrResult.ref);
                if (!entry) continue;

                const { law, article } = entry;

                // フィルタリング
                if (law.lawType === '法律' && !filters.law) continue;
                if (law.lawType === '省令' && !filters.ordinance) continue;

                const score = Math.round(lunrResult.score * 100);

                articleResults.push({
                    lawId: law.lawId,
                    lawName: law.lawName,
                    lawType: law.lawType,
                    articleNumber: article.articleNumber,
                    title: article.title,
                    content: article.content,
                    paragraphs: article.paragraphs,
                    score,
                    highlightedTitle: this.highlightText(article.title, allTerms),
                    highlightedContent: this.highlightText(
                        article.content.substring(0, 300) + (article.content.length > 300 ? '...' : ''),
                        allTerms
                    )
                });
            }
        }

        articleResults.sort((a, b) => b.score - a.score);

        // PDF検索
        const pdfResults = this.searchPDFs(parsedQuery);

        const searchModeText = parsedQuery.mode === 'OR' ? 'OR検索' : 'AND検索';
        console.log(`🔍 検索完了 (${searchModeText}, Lunr): "${query}" → 条文${articleResults.length}件、PDF${pdfResults.length}件`);

        return { articles: articleResults, pdfs: pdfResults };
    }

    // ========================================
    // 統計情報の取得
    // ========================================
    getStats() {
        if (!this.isReady) return null;

        let totalArticles = 0;
        for (const law of this.laws) {
            totalArticles += law.articles.length;
        }

        return {
            lawCount: this.laws.length,
            articleCount: totalArticles,
            synonymCount: Object.keys(this.synonyms).length,
            standardsCount: this.pdfContent.standards.length,
            detailsCount: this.pdfContent.details.length,
            appendicesCount: this.pdfContent.appendices.length,
            otherCount: this.pdfContent.other.length
        };
    }
}

// グローバルインスタンス
const searchEngine = new SearchEngine();
