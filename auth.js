// आपके लाइव रेंडर सर्वर का लिंक
const API_URL = "https://color-game-1kc2.onrender.com";

let redirectAction = null;

// प्रीमियम कstमाइज्ड सुंदर-सुंदर पॉपअप को स्क्रीन पर दिखाने वाला फंक्शन
function showAuthAlert(title, message, icon = '❌', action = null) {
    if (typeof openCustomModal === 'function') {
        openCustomModal(title, message, icon, action);
    } else {
        alert(message);
        if (action) action();
    }
}

// बिना पेज लोड किए स्क्रीन बदलने का फंक्शन
function showScreen(screenId) {
    document.querySelectorAll('.form-page').forEach(page => page.classList.remove('active'));
    const targetScreen = document.getElementById(screenId);
    if(targetScreen) targetScreen.classList.add('active');
    
    const title = document.getElementById('page-title');
    const desc = document.getElementById('page-desc');

    if(screenId === 'register-screen') {
        if(title) title.innerText = "Register";
        if(desc) desc.innerHTML = "Create your brand new account.<br>Make sure to fill all fields carefully.";
    } else {
        if(title) title.innerText = "Log in";
        if(desc) desc.innerHTML = "Please log in with your new phone number.<br>If you forget your password, please contact customer service.";
    }
}

// पासवर्ड दिखाने और छुपाने का आँख वाला फंक्शन
function togglePass(inputId, iconElement) {
    const input = document.getElementById(inputId);
    if(input && input.type === "password") {
        input.type = "text";
        iconElement.classList.replace('fa-eye-slash', 'fa-eye');
    } else if(input) {
        input.type = "password";
        iconElement.classList.replace('fa-eye', 'fa-eye-slash');
    }
}

// न्यू रजिस्ट्रेशन हैंडलर (डेटाबेस में बिल्कुल न्यू ID और फ्रेश डेटा जोड़ने के लिए)
async function processRegistration(event) {
    event.preventDefault();
    let phone = document.getElementById('phone')?.value.trim();
    let pass = document.getElementById('password')?.value.trim();
    let confirmPass = document.getElementById('confirm-password')?.value.trim();
    let inviteCode = document.getElementById('refer-code')?.value.trim() || "";

    if (!phone || phone.length < 10) {
        showAuthAlert("Invalid Number", "Please enter a valid 10-digit mobile number!", "❌");
        return;
    }
    if (pass !== confirmPass) {
        showAuthAlert("Mismatch Error", "Passwords do not match! Please check again.", "❌");
        return;
    }

    try {
        let response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password: pass, ref: inviteCode })
        });
        let data = await response.json();
        
        if (data.success) {
            // रजिस्ट्रेशन होने पर अब सुंदर-सुंदर पॉपअप दिखेगा
            showAuthAlert("Account Created", "Your new ID has been registered! Click OK to Login.", "✅", () => {
                isLoginMode = true;
                showScreen('login-screen');
                
                // बटन का टेक्स्ट और फॉर्म वापस लॉगिन मोड पर सेट करना
                const tBtn = document.getElementById('toggle-btn');
                const sBtn = document.getElementById('submit-btn');
                if(tBtn) tBtn.innerText = "Register";
                if(sBtn) sBtn.innerText = "Log in";
                
                const nG = document.getElementById('name-group');
                const cG = document.getElementById('confirm-group');
                const rG = document.getElementById('refer-group');
                if(nG) nG.style.display = "none";
                if(cG) cG.style.display = "none";
                if(rG) rG.style.display = "none";
            });
        } else {
            showAuthAlert("Already Exists", data.message || "This number is already registered!", "❌");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Unable to connect to the game server. Please try again!", "⚠️");
    }
}
// न्यू आईडी लॉगिन हैंडलर (सिर्फ अब का नया डेटा उठाने के लिए)
async function processLogin(event) {
    event.preventDefault();
    let phone = document.getElementById('phone')?.value.trim();
    let password = document.getElementById('password')?.value.trim();

    if (!phone || !password) {
        showAuthAlert("Input Required", "Please enter phone number and password!", "❌");
        return;
    }

    try {
        let response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        let data = await response.json();

        if (data.success) {
            // नई आईडी का फ्रेश डेटा लोकल स्टोरेज में सेव करना
            localStorage.setItem('user_phone', phone);
            
            // लॉगिन होने पर सुंदर-सुंदर "Success" पॉपअप खुलेगा
            showAuthAlert("91 GOA CLUB", "Login Successful! Opening your game room...", "✅", () => {
            	
                window.location.href = "home.html";
            });
        } else {
            showAuthAlert("Login Failed", data.message || "Invalid phone number or password!", "❌");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Backend server is sleeping. Performing local redirection test...", "⚠️", () => {
            localStorage.setItem('user_phone', phone);
            window.location.href = "home.html";
        });
    }
}

// इनवाइट कोड ऑटो-लोड करने का लॉजिक
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    const inviteInput = document.getElementById('refer-code');
    
    if (inviteInput && refCode) {
        let cleanRef = refCode.trim();
        if (cleanRef !== "" && cleanRef !== "null" && cleanRef !== "undefined") {
            inviteInput.value = cleanRef;
        }
    }
});
