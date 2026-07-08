const socket = io("https://color-game-1kc2.onrender.com");

document.addEventListener("DOMContentLoaded", () => {
    let loggedUser = localStorage.getItem('user_phone');
    if (!loggedUser) {
        alert("Please login first!");
        window.location.href = "index.html";
        return;
    }
    fetchUserBalance(loggedUser);
    startBannerSlider();
});

async function fetchUserBalance(phone) {
    try {
        let response = await fetch(`${API_URL}/api/balance/${phone}`);
        let data = await response.json();
        if (data.success) {
            document.getElementById('home-balance').innerText = parseFloat(data.balance).toFixed(2);
        } else {
            console.error("Balance fetch error:", data.message);
        }
    } catch (error) {
        console.error("Server error while fetching balance:", error);
    }
}

function refreshBalance() {
    let loggedUser = localStorage.getItem('user_phone');
    let btn = document.querySelector('.refresh-btn');
    if (btn) btn.style.transform = "rotate(360deg)";
    
    setTimeout(() => {
        if (loggedUser) {
            fetchUserBalance(loggedUser);
        }
        if (btn) btn.style.transform = "rotate(0deg)";
        alert("Balance Updated from Database!");
    }, 500);
}

function startBannerSlider() {
    const slider = document.getElementById('slider');
    if (!slider) return;
    let currentIndex = 0;
    const totalBanners = 5;
    
    setInterval(() => {
        currentIndex++;
        if (currentIndex >= totalBanners) {
            currentIndex = 0;
        }
        let offset = currentIndex * -20;
        slider.style.transform = `translateX(${offset}%)`;
    }, 3000);
}

function openGame(modeKey) {
    if (!modeKey) modeKey = '30s';
    window.location.href = `game.html?mode=${modeKey}`;
}
// 🖐️ तैरते हुए आइकन्स को उंगली से ड्रैग (Drag) करने का लॉजिक
const widgetGroup = document.getElementById('floating-widget-group');
let isDragging = false;
let startX, startY, initialX, initialY;

if (widgetGroup) {
    widgetGroup.addEventListener('touchstart', (e) => {
        isDragging = false;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        initialX = widgetGroup.offsetLeft;
        initialY = widgetGroup.offsetTop;
    }, { passive: true });

    widgetGroup.addEventListener('touchmove', (e) => {
        let currentX = e.touches[0].clientX;
        let currentY = e.touches[0].clientY;
        
        if (Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5) {
            isDragging = true; 
            let moveX = currentX - startX;
            let moveY = currentY - startY;
            let newLeft = initialX + moveX;
            let newTop = initialY + moveY;
            
            if (newLeft > 0 && newLeft < (window.innerWidth - widgetGroup.offsetWidth)) {
                widgetGroup.style.left = newLeft + 'px';
                widgetGroup.style.right = 'auto';
            }
            if (newTop > 0 && newTop < (window.innerHeight - widgetGroup.offsetHeight)) {
                widgetGroup.style.top = newTop + 'px';
                widgetGroup.style.bottom = 'auto';
            }
        }
    }, { passive: true });

    widgetGroup.addEventListener('touchend', (e) => {
        if (isDragging) { e.preventDefault(); }
    });
}
// सर्वर का मुख्य URL (आपके server.js से जोड़ने के लिए)
const HOME_API_URL = "https://onrender.com";

// पेज लोड होते ही नए अपडेट की जांच करना
window.addEventListener("DOMContentLoaded", () => {
    checkLatestGameNotice();
});

function checkLatestGameNotice() {
    fetch(`${HOME_API_URL}/api/user/get-notices`)
    .then(res => res.json())
    .then(data => {
        if (data.success && data.latest && data.latest.length > 0) {
            const latestNotice = data.latest[0]; // सबसे पहला नया मैसेज
            const noticeId = latestNotice._id;
            const lastSeenNoticeId = localStorage.getItem('last_seen_notice_id');
            
            if (lastSeenNoticeId !== noticeId) {
                const textMsgElement = document.getElementById("user-popup-text-msg");
                const popupElement = document.getElementById("user-alert-popup");
                const redDotElement = document.getElementById("noti-red-dot");
                
                if(textMsgElement) textMsgElement.innerText = latestNotice.message;
                if(popupElement) popupElement.style.display = "flex";
                if(redDotElement) redDotElement.style.display = "block";
            }
        }
    })
    .catch(err => console.error("Notice Fetch Error:", err));
}

// पॉपअप को बंद (Cut) करने का ग्लोबल फंक्शन
window.closeUserPopup = function() {
    const popupElement = document.getElementById("user-alert-popup");
    if(popupElement) popupElement.style.display = "none";
    
    fetch(`${HOME_API_URL}/api/user/get-notices`)
    .then(res => res.json())
    .then(data => {
        if (data.success && data.latest && data.latest.length > 0) {
            localStorage.setItem('last_seen_notice_id', data.latest[0]._id);
        }
    });
}
