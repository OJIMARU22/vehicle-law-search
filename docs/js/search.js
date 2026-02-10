// ========================================
// 検索エンジン
// ========================================

class SearchEngine {
    constructor() {
        this.laws = [];
        this.synonyms = {};
        this.pdfMetadata = { details: [], appendices: [] };
        this.pdfContent = { standards: [], details: [], appendices: [], other: [] };
        this.isReady = false;
    }

    // データの読み込み
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

            // 各プロパティが存在しない場合は空配列をデフォルトとして設定
            this.pdfContent = {
                standards: pdfData.standards || [],
                details: pdfData.details || [],
                appendices: pdfData.appendices || [],
                other: pdfData.other || []
            };
            this.isReady = true;

            const totalPdfs = this.pdfContent.standards.length +
                this.pdfContent.details.length +
                this.pdfContent.appendices.length +
                this.pdfContent.other.length;

            console.log(`✅ データ読み込み完了: ${this.laws.length}件の法令`);
            console.log(`📄 PDF資料: ${totalPdfs}件（保安基準${this.pdfContent.standards.length}件、細目告示${this.pdfContent.details.length}件、別添${this.pdfContent.appendices.length}件、その他${this.pdfContent.other.length}件）`);
            return true;
        } catch (error) {
            console.error('❌ データ読み込みエラー:', error);
            return false;
        }
    }

    // 同義語展開
    expandSynonyms(query) {
        const terms = new Set([query.toLowerCase()]);

        // 同義語辞書を検索
        for (const [key, synonyms] of Object.entries(this.synonyms)) {
            const keyLower = key.toLowerCase();
            const synonymsLower = synonyms.map(s => s.toLowerCase());

            // クエリが辞書のキーに含まれる場合
            if (query.toLowerCase().includes(keyLower)) {
                terms.add(keyLower);
                synonymsLower.forEach(s => terms.add(s));
            }

            // クエリが同義語のいずれかに含まれる場合
            if (synonymsLower.some(s => query.toLowerCase().includes(s))) {
                terms.add(keyLower);
                synonymsLower.forEach(s => terms.add(s));
            }
        }

        return Array.from(terms);
    }

    // テキストのハイライト
    highlightText(text, terms) {
        if (!text || terms.length === 0) return text;

        let result = text;
        const sortedTerms = terms.sort((a, b) => b.length - a.length);

        for (const term of sortedTerms) {
            if (term.length < 2) continue;

            const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
            result = result.replace(regex, '<span class="highlight">$1</span>');
        }

        return result;
    }

    // 正規表現のエスケープ
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // スコア計算
    calculateScore(article, query, terms) {
        let score = 0;
        const content = (article.title + ' ' + article.content).toLowerCase();
        const queryLower = query.toLowerCase();

        // 完全一致ボーナス
        if (content.includes(queryLower)) {
            score += 100;
        }

        // 各検索語のマッチング
        for (const term of terms) {
            const termLower = term.toLowerCase();
            const matches = (content.match(new RegExp(this.escapeRegex(termLower), 'gi')) || []).length;
            score += matches * 10;

            // タイトルに含まれる場合はボーナス
            if (article.title.toLowerCase().includes(termLower)) {
                score += 50;
            }
        }

        return score;
    }

    // PDF資料の検索
    searchPDFs(query, terms) {
        const pdfResults = [];

        // すべてのPDFカテゴリを検索
        const categories = [
            { data: this.pdfContent.standards, type: 'standard', label: '保安基準' },
            { data: this.pdfContent.details, type: 'detail', label: '細目告示' },
            { data: this.pdfContent.appendices, type: 'appendix', label: '別添' },
            { data: this.pdfContent.other, type: 'other', label: 'その他' }
        ];

        for (const category of categories) {
            for (const pdf of category.data) {
                const searchText = (
                    pdf.title + ' ' +
                    pdf.content + ' ' +
                    (pdf.keywords || []).join(' ')
                ).toLowerCase();

                let score = 0;
                let matchedTerms = [];

                // 各検索語のマッチング
                for (const term of terms) {
                    const termLower = term.toLowerCase();
                    if (searchText.includes(termLower)) {
                        const matches = (searchText.match(new RegExp(this.escapeRegex(termLower), 'gi')) || []).length;
                        score += matches * 5;
                        matchedTerms.push(term);

                        // タイトルに含まれる場合はボーナス
                        if (pdf.title.toLowerCase().includes(termLower)) {
                            score += 30;
                        }
                    }
                }

                if (score > 0) {
                    // コンテンツのプレビューを作成（最初のマッチ周辺を表示）
                    let preview = pdf.content.substring(0, 200);
                    for (const term of matchedTerms) {
                        const index = pdf.content.toLowerCase().indexOf(term.toLowerCase());
                        if (index !== -1 && index < 500) {
                            const start = Math.max(0, index - 50);
                            const end = Math.min(pdf.content.length, index + 150);
                            preview = '...' + pdf.content.substring(start, end) + '...';
                            break;
                        }
                    }

                    pdfResults.push({
                        type: category.type,
                        typeLabel: category.label,
                        id: pdf.id,
                        title: pdf.title,
                        content: preview,
                        fullContent: pdf.content,
                        keywords: pdf.keywords || [],
                        fullTextLength: pdf.fullTextLength || pdf.content.length,
                        score: score,
                        highlightedTitle: this.highlightText(pdf.title, terms),
                        highlightedContent: this.highlightText(preview, terms)
                    });
                }
            }
        }

        // スコアでソート
        pdfResults.sort((a, b) => b.score - a.score);

        return pdfResults;
    }

    // 検索実行
    search(query, filters = { law: true, ordinance: true, details: true, appendices: true }) {
        if (!this.isReady || !query || query.trim().length === 0) {
            return { articles: [], pdfs: [] };
        }

        const terms = this.expandSynonyms(query.trim());
        const articleResults = [];

        // 法令条文を検索
        for (const law of this.laws) {
            // フィルター適用
            if (law.lawType === '法律' && !filters.law) continue;
            if (law.lawType === '省令' && !filters.ordinance) continue;

            for (const article of law.articles) {
                const content = (article.title + ' ' + article.content).toLowerCase();

                // いずれかの検索語にマッチするか確認
                const matches = terms.some(term =>
                    content.includes(term.toLowerCase())
                );

                if (matches) {
                    const score = this.calculateScore(article, query, terms);

                    articleResults.push({
                        lawId: law.lawId,
                        lawName: law.lawName,
                        lawType: law.lawType,
                        articleNumber: article.articleNumber,
                        title: article.title,
                        content: article.content,
                        paragraphs: article.paragraphs,
                        score: score,
                        highlightedTitle: this.highlightText(article.title, terms),
                        highlightedContent: this.highlightText(
                            article.content.substring(0, 300) +
                            (article.content.length > 300 ? '...' : ''),
                            terms
                        )
                    });
                }
            }
        }

        // スコアでソート
        articleResults.sort((a, b) => b.score - a.score);

        // PDF資料を検索
        const pdfResults = this.searchPDFs(query, terms);

        console.log(`🔍 検索完了: "${query}" → 条文${articleResults.length}件、PDF資料${pdfResults.length}件`);
        console.log(`📝 展開された検索語: ${terms.join(', ')}`);

        return {
            articles: articleResults,
            pdfs: pdfResults
        };
    }

    // 統計情報の取得
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
