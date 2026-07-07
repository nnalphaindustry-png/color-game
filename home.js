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
