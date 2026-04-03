// =========================================================================
// API 金鑰與設定參數（請填入您自己的資訊）
// =========================================================================
// 請將發布後的 Web App URL 貼在這裡：
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw4-dxRuQ7e2iorqvle9P-kyw7jn09ZHbh8J09BJcyYZbJpu2HJ2TN492lvcr0eOGFw/exec';

// =========================================================================
// 全域變數
// =========================================================================
let globalOrders = []; // 暫存所有讀取的訂單

// 目標過濾的餐點選項
const TARGET_OPTIONS = ['蟹蟹鍋', '菊A', '菊B'];

// 初始化時設定今天的日期
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    // input type="date" 格式為 YYYY-MM-DD
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('operation-date').value = `${yyyy}-${mm}-${dd}`;
    
    document.getElementById('month-filter').value = `${yyyy}-${mm}`;
    
    // 網頁載入後，直接從 GAS 抓取資料
    fetchData();
});

// =========================================================================
// 資料擷取與更新 (無須登入，改串接 Google Apps Script)
// =========================================================================

async function fetchData() {
    try {
        if (!WEB_APP_URL || WEB_APP_URL.includes('在此處貼上')) {
            document.getElementById('orders-list').innerHTML = '<div class="loading-text" style="color:red;">請先在 yr.js 中填寫 WEB_APP_URL！</div>';
            return;
        }

        document.getElementById('orders-list').innerHTML = '<div class="loading-text">資料載入中，請稍後...</div>';
        
        // 使用原生的 fetch 取代 gapi
        const response = await fetch(WEB_APP_URL);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        const values = data.values;
        if (!values || values.length === 0) {
            document.getElementById('orders-list').innerHTML = '<div class="loading-text">找不到任何資料。</div>';
            return;
        }

        // 解析資料為物件格式
        globalOrders = values.map((row, index) => {
            return {
                rowId: index + 2, // 因為我們從 A2 開始讀取，第一筆資料是第 2 列
                orderId: row[0] || '',
                name: row[2] || '',
                ticketNo: row[5] || '', // F 欄: 券號
                option: row[6] || '',
                date: row[7] || '', // H 欄: 餐日期
                time: row[8] || '', // I 欄: 餐時間
                memo: row[10] || '', // K 欄: 備註
                used: row[11] || '' // L 欄: "已用券"
            };
        }).filter(order => TARGET_OPTIONS.includes(order.option)); // 預先過濾出我們關心的餐點

        renderApp();
        renderMonthlyStats();

    } catch (err) {
        document.getElementById('orders-list').innerHTML = `<div class="loading-text" style="color:red;">讀取失敗：${err.message}</div>`;
        console.error(err);
    }
}

// 更新 Google Sheet 狀態
async function markAsUsed(rowId, isChecked) {
    try {
        const value = isChecked ? 'V' : ''; // 勾選打 V，取消清空
        
        // 呼叫 GAS 發布的 doPost 來寫入資料
        // 使用 Content-Type: text/plain 可以避免觸發不必要的 CORS OPTIONS 請求
        const response = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify({
                rowId: rowId,
                value: value
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        // 局部更新本地端資料並重繪
        const order = globalOrders.find(o => o.rowId === rowId);
        if (order) {
            order.used = value;
            renderApp();
            renderMonthlyStats(); 
        }

    } catch (err) {
        alert(`更新失敗: ${err.message}`);
        console.error(err);
        // 回復 checkbox 狀態
        document.querySelector(`.checkbox-row-${rowId}`).checked = !isChecked;
    }
}

// =========================================================================
// 介面渲染
// =========================================================================

// 解析 YYYY-MM-DD 並轉換為 Google Sheet 內的格式 "M/D" 以便比對
function dateToSheetFormat(dateStr) {
    if (!dateStr) return '';
    const dateObj = new Date(dateStr);
    const m = dateObj.getMonth() + 1;
    const d = dateObj.getDate();
    return `${m}/${d}`;  // 產生如 3/31 的格式
}

// 根據所選日期過濾並渲染畫面的主函式
function renderApp() {
    const dateInput = document.getElementById('operation-date').value;
    const targetDateStr = dateToSheetFormat(dateInput);
    
    // 過濾出符合今日日期的訂單
    const dailyOrders = globalOrders.filter(order => {
        const orderDateParts = order.date.split('/');
        if (orderDateParts.length === 2) {
            const om = parseInt(orderDateParts[0], 10);
            const od = parseInt(orderDateParts[1], 10);
            return `${om}/${od}` === targetDateStr;
        }
        return order.date === targetDateStr;
    });

    // 依據時間先後排序
    dailyOrders.sort((a, b) => {
        const parseTime = (timeStr) => {
            if (!timeStr) return 9999;
            const parts = timeStr.split(':');
            return parts.length === 2 ? parseInt(parts[0]) * 60 + parseInt(parts[1]) : 9999;
        };
        return parseTime(a.time) - parseTime(b.time);
    });

    renderOrdersList(dailyOrders);
    renderDailyStats(dailyOrders, `${targetDateStr} (${dailyOrders.length} 份)`);
}

function renderOrdersList(orders) {
    const listContainer = document.getElementById('orders-list');
    
    if (orders.length === 0) {
        listContainer.innerHTML = '<div class="loading-text">此日期尚無符合的訂單。</div>';
        return;
    }

    let html = '';
    orders.forEach(order => {
        const isUsed = order.used.trim() !== '';
        
        // 判斷是否包含「自費」，若有則套用顯眼的紅字與大字體樣式
        const isSelfPay = order.ticketNo.includes('自費');
        const ticketStyle = isSelfPay 
            ? "font-size: 1.15rem; font-weight: bold; color: #dc2626; background: #fee2e2; border: 1px solid #f87171; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px;"
            : "font-size: 0.8rem; font-weight: normal; color: var(--text-muted); background: #f3e8dd; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;";
        
        html += `
        <div class="order-card ${isUsed ? 'used' : ''}">
            <div class="order-left-group">
                <div class="time-slot" style="min-width: 85px;">
                    <span style="font-size: 0.8rem; font-weight: bold; color: var(--primary-hover); opacity: 0.8; margin-bottom: 2px;">${order.date || '無日期'}</span>
                    <span class="time">${order.time || '未定'}</span>
                </div>
                <div class="user-info">
                    <div class="meal-badge badge-${order.option}" style="font-size: 1.25rem; font-weight: 700; padding: 6px 14px; margin-bottom: 6px; display: inline-block;">
                        ${order.option || '無內容'}
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.05rem; font-weight: 500; color: var(--text-main);">${order.name || '無名稱'}</span>
                        <span style="${ticketStyle}">券號: ${order.ticketNo || '無'}</span>
                    </div>
                    ${order.memo ? `<div style="font-size: 0.85rem; color: #92400e; background: #fffbeb; padding: 4px 8px; border-radius: 6px; margin-top: 8px; border-left: 3px solid #fcd34d; font-weight: 500;">備註：${order.memo}</div>` : ''}
                </div>
            </div>
            <div class="order-action">
                <label class="check-container"> 已用券
                    <input type="checkbox" class="checkbox-row-${order.rowId}" 
                           ${isUsed ? 'checked' : ''} 
                           onchange="markAsUsed(${order.rowId}, this.checked)">
                    <span class="checkmark"></span>
                </label>
            </div>
        </div>
        `;
    });

    listContainer.innerHTML = html;
}

function renderDailyStats(orders, dateLabel) {
    document.getElementById('current-date-display').innerText = dateLabel;
    
    // 計算各品項總數
    let stats = { '蟹蟹鍋': 0, '菊A': 0, '菊B': 0 };
    orders.forEach(o => {
        if (stats[o.option] !== undefined) stats[o.option]++;
    });

    // 渲染統計格
    let gridHtml = '';
    Object.keys(stats).forEach(key => {
        gridHtml += `<div class="stat-item"><span class="label">${key}</span><span class="value">${stats[key]}</span></div>`;
    });
    document.getElementById('daily-stats-grid').innerHTML = gridHtml;

    // 渲染時間軸
    const timeGroups = {};
    orders.forEach(o => {
        const t = o.time || '未定';
        if (!timeGroups[t]) timeGroups[t] = [];
        timeGroups[t].push(o.option);
    });

    const timelineContainer = document.getElementById('daily-timeline');
    let timelineHtml = '';
    
    Object.keys(timeGroups).forEach(time => {
        let itemCounts = {};
        timeGroups[time].forEach(opt => {
            itemCounts[opt] = (itemCounts[opt] || 0) + 1;
        });
        
        let itemsHtml = '';
        Object.keys(itemCounts).forEach(opt => {
            itemsHtml += `<span class="timeline-item">${opt} x ${itemCounts[opt]}</span>`;
        });

        timelineHtml += `
        <div class="time-row">
            <div class="time-col">${time}</div>
            <div class="items-col">
                ${itemsHtml}
            </div>
        </div>`;
    });
    
    if (orders.length === 0) timelineHtml = '<p style="color:#8a7a70; font-size: 0.9rem;">無出餐排程</p>';
    
    timelineContainer.innerHTML = timelineHtml;
}

function renderMonthlyStats() {
    const monthInput = document.getElementById('month-filter').value;
    if (!monthInput) return;
    
    const parts = monthInput.split('-');
    const targetMonth = parseInt(parts[1], 10);
    
    let stats = { '蟹蟹鍋': 0, '菊A': 0, '菊B': 0 };

    globalOrders.forEach(order => {
        const orderDateParts = order.date.split('/');
        if (orderDateParts.length === 2) {
            const om = parseInt(orderDateParts[0], 10);
            if (om === targetMonth) {
                if (stats[order.option] !== undefined) stats[order.option]++;
            }
        }
    });

    let gridHtml = '';
    Object.keys(stats).forEach(key => {
        gridHtml += `<div class="stat-item"><span class="label">${key}</span><span class="value">${stats[key]}</span></div>`;
    });
    document.getElementById('monthly-stats-grid').innerHTML = gridHtml;
}
