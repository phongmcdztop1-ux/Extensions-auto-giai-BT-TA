// Auto-focus vào textarea khi mở popup
document.addEventListener('DOMContentLoaded', () => {
    const descriptionTextarea = document.getElementById('description');
    descriptionTextarea.focus();
});

// Bắt phím Enter ở bất kỳ đâu trong popup để chụp nhanh
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('captureBtn').click();
    }
});


document.getElementById('captureBtn').addEventListener('click', () => {
    const description = document.getElementById('description').value;
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
            console.error('Lỗi chụp màn hình:', chrome.runtime.lastError)
            document.getElementById('error').textContent = 'Lỗi: Không thể chụp màn hình.'
            document.getElementById('error').style.display = 'block'
            return
        }
        fetch(dataUrl)
            .then(res => res.blob())
            .then(blob => {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                    .then(() => {
                        document.getElementById('initial-content').style.display = 'none'
                        const mainContent = document.getElementById('main-content')
                        mainContent.style.display = 'block'
                        mainContent.classList.add('visible')
                        triggerGeminiRequest(dataUrl, description)
                    })
                    .catch(err => {
                        console.error('Lỗi khi lưu ảnh vào bộ nhớ tạm:', err)
                        document.getElementById('error').textContent = 'Lỗi: Không thể lưu ảnh vào bộ nhớ tạm.'
                        document.getElementById('error').style.display = 'block'
                    })
            })
            .catch(err => {
                console.error('Lỗi khi chuyển đổi ảnh:', err)
                document.getElementById('error').textContent = 'Lỗi: Không thể xử lý ảnh chụp.'
                document.getElementById('error').style.display = 'block'
            })
    })
})

const GROQ_API_KEYS = [
    { key: '', name: 'Key 1' },
    { key: '', name: 'Key 2' }
];
let currentKeyIndex = 0;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'qwen/qwen3.8-27b'

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Hàm escape HTML để tránh XSS
function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

// Hàm render LaTeX với KaTeX - FIXED VERSION
function renderLatexResponse(text) {
    const responseDiv = document.getElementById('response')

    // BƯỚC 1: Tạm thời thay thế các LaTeX blocks bằng placeholder
    // để không bị ảnh hưởng bởi việc xử lý markdown
    const latexBlocks = []
    let processedText = text

    // Lưu $$ display blocks (multiline)
    processedText = processedText.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        latexBlocks.push(match)
        return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`
    })

    // Lưu $ inline blocks
    processedText = processedText.replace(/\$([^\$\n]+?)\$/g, (match) => {
        latexBlocks.push(match)
        return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`
    })

    // Lưu \[...\] display blocks
    processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, (match) => {
        latexBlocks.push(match)
        return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`
    })

    // Lưu \(...\) inline blocks
    processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, (match) => {
        latexBlocks.push(match)
        return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`
    })

    // BƯỚC 2: Escape HTML (cho phần không phải LaTeX)
    processedText = processedText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    // BƯỚC 3: Xử lý markdown
    processedText = processedText
        // XÓA dòng trống TRƯỚC khi xử lý markdown
        .replace(/^\s*\n/gm, '\n')           // Xóa dòng chỉ có whitespace
        .replace(/\n{2,}/g, '\n')            // 2+ newlines thành 1
        .trim()                               // Xóa whitespace đầu cuối
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic  
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Headers (order matters: longest first) - margin nhỏ hơn
        .replace(/^#{6}\s*(.+)$/gm, '<h6 style="margin:4px 0 2px;color:#00d4ff;font-size:14px;">$1</h6>')
        .replace(/^#{5}\s*(.+)$/gm, '<h5 style="margin:4px 0 2px;color:#00d4ff;font-size:15px;">$1</h5>')
        .replace(/^#{4}\s*(.+)$/gm, '<h5 style="margin:4px 0 2px;color:#00d4ff;font-size:15px;">$1</h5>')
        .replace(/^#{3}\s*(.+)$/gm, '<h4 style="margin:6px 0 3px;color:#00d4ff;font-size:16px;">$1</h4>')
        .replace(/^#{2}\s*(.+)$/gm, '<h3 style="margin:8px 0 4px;color:#00d4ff;font-size:17px;">$1</h3>')
        .replace(/^#{1}\s+(.+)$/gm, '<h2 style="margin:10px 0 5px;color:#00d4ff;font-size:18px;">$1</h2>')
        // Line breaks
        .replace(/\n/g, '<br>')
        // Xóa các br liên tiếp (bao gồm có space)
        .replace(/(<br>\s*){2,}/g, '<br>')
        // Xóa br ngay sau header
        .replace(/(<\/h[1-6]>)\s*<br>/g, '$1')
        // Xóa br ngay trước header
        .replace(/<br>\s*(<h[1-6])/g, '$1')

    // BƯỚC 4: Khôi phục LaTeX blocks
    for (let i = 0; i < latexBlocks.length; i++) {
        // Với display blocks ($$), thêm div wrapper để xuống dòng
        let latex = latexBlocks[i]
        if (latex.startsWith('$$') || latex.startsWith('\\[')) {
            processedText = processedText.replace(
                `%%LATEX_BLOCK_${i}%%`,
                `<div class="math-display">${latex}</div>`
            )
        } else {
            processedText = processedText.replace(
                `%%LATEX_BLOCK_${i}%%`,
                `<span class="math-inline">${latex}</span>`
            )
        }
    }

    responseDiv.innerHTML = processedText

    // BƯỚC 5: Render LaTeX với KaTeX
    if (typeof renderMathInElement !== 'undefined') {
        try {
            renderMathInElement(responseDiv, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false }
                ],
                throwOnError: false,
                errorColor: '#ff6b6b',
                trust: true,
                strict: false,
                output: 'html'
            })
        } catch (e) {
            console.error('KaTeX render error:', e)
        }
    } else {
        console.error('renderMathInElement not loaded!')
    }
}

async function fetchWithRetry(url, options, retries = 3, delayMs = 5000) {
    for (let i = 0; i < retries; i++) {
        const response = await fetch(url, options)
        if (response.status === 429) {
            if (i === retries - 1) throw new Error('Lỗi API: 429 - Vượt quá hạn mức yêu cầu, vui lòng thử lại sau.')
            await delay(delayMs)
            continue
        }
        if (!response.ok) throw new Error(`Lỗi API: ${response.status} ${response.statusText}`)
        return response
    }
}

async function triggerGroqRequest(dataUrl, description) {
    const responseDiv = document.getElementById('response')
    const errorDiv = document.getElementById('error')
    const spinner = document.getElementById('spinner')
    const statusDiv = document.getElementById('status')
    responseDiv.innerHTML = ''
    errorDiv.textContent = ''
    errorDiv.style.display = 'none'
    statusDiv.style.display = 'block'
    spinner.style.display = 'block'

    try {
        if (!dataUrl) {
            throw new Error('Không có ảnh chụp màn hình để xử lý.')
        }

        let generatedText = null

        // Thử lần lượt các key, tự động đổi key nếu gặp lỗi 429 (Rate Limit)
        for (let attempt = 0; attempt < GROQ_API_KEYS.length; attempt++) {
            const keyIdx = (currentKeyIndex + attempt) % GROQ_API_KEYS.length
            const apiKey = GROQ_API_KEYS[keyIdx].key

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: GROQ_MODEL,
                        messages: [{
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: `Bạn là chuyên gia giải bài tập môn TIẾNG ANH. Hãy giải toàn bộ câu hỏi trong ảnh. ${description ? 'Yêu cầu thêm: ' + description : ''}

QUY TẮC:
- Ghi rõ từng câu: **Câu 1:** **[Đáp án]** (Ví dụ: **1. A - although**)
- Trắc nghiệm: Ghi rõ chữ cái (A/B/C/D) kèm nội dung của đáp án đó
- Giải thích siêu ngắn gọn (cấu trúc ngữ pháp/từ vựng/dịch nghĩa trong 1 dòng)
- Điền từ / viết lại câu / chia thì: Đưa ra đáp án chuẩn xác ngay lập tức
- Đi thẳng vào đáp án, KHÔNG tóm tắt đề, KHÔNG dài dòng`
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: dataUrl
                                    }
                                }
                            ]
                        }],
                        temperature: 0.1,
                        max_tokens: 4096
                    })
                })

                if (response.status === 429) {
                    statusDiv.textContent = `⏳ ${GROQ_API_KEYS[keyIdx].name} bị hạn mức (429), đang chuyển sang key tiếp theo...`
                    continue
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}))
                    throw new Error(errData.error?.message || `Lỗi API: ${response.status} ${response.statusText}`)
                }

                const data = await response.json()
                generatedText = data.choices?.[0]?.message?.content
                if (!generatedText) throw new Error('Không nhận được phản hồi từ Groq API.')

                currentKeyIndex = keyIdx
                break
            } catch (err) {
                if (attempt === GROQ_API_KEYS.length - 1) throw err
            }
        }

        console.log('Raw API response:', generatedText.substring(0, 500))

        // Render LaTeX với KaTeX
        renderLatexResponse(generatedText)

    } catch (error) {
        errorDiv.textContent = 'Lỗi: ' + error.message
        errorDiv.style.display = 'block'
        responseDiv.innerHTML = 'Không thể hiển thị kết quả do lỗi.'
    } finally {
        statusDiv.style.display = 'none'
        spinner.style.display = 'none'
    }
}

const triggerGeminiRequest = triggerGroqRequest;
