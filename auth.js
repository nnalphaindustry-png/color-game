// आपके लाइव रेंडर सर्वर का लिंक
const API_URL = "https://color-game-1kc2.onrender.com";

let redirectAction = null;

// एरर या सफलता का सुंदर अलर्ट दिखाने वाला फंक्शन
function showAuthAlert(title, message, icon = '', action = null) {
    const iconEl = document.getElementById("authAlertIcon");
    const titleEl = document.getElementById("authAlertTitle");
    const msgEl = document.getElementById("authAlertMessage");
    const alertEl = document.getElementById("authAlert");

    if(iconEl) iconEl.innerText = icon;
    if(titleEl) titleEl.innerText = title;
    if(msgEl) msgEl.innerText = message;
    
    redirectAction = action;
    if(alertEl) alertEl.classList.add("show");
}

// अलर्ट बॉक्स बंद करने और आगे भेजने का लॉजिक
function closeAuthAlert() {
    const alertEl = document.getElementById("authAlert");
    if(alertEl) alertEl.classList.remove("show");
    if (typeof redirectAction === 'function') {
        redirectAction();
    }
}

// बिना पेज लोड किए लॉगिन और रजिस्ट्रेशन स्क्रीन बदलने का फंक्शन
function showScreen(screenId) {
    document.querySelectorAll('.form-page').forEach(page => page.classList.remove('active'));
    
    const targetScreen = document.getElementById(screenId);
    if(targetScreen) targetScreen.classList.add('active');
    
    const title = document.getElementById('page-title');
    const desc = document.getElementById('page-desc');

    if(screenId === 'register-screen') {
        if(title) title.innerText = "Register";
        if(desc) desc.innerHTML = "Create your new account to start earning bonuses.<br>Make sure to fill all fields carefully.";
    } else {
        if(title) title.innerText = "Log in";
        if(desc) desc.innerHTML = "Please log in with your phone number or email.<br>If you forget your password, please contact customer service.";
    }
}

// पासवर्ड दिखाने और छुपाने (Eye Icon) का फंक्शन
function togglePass(inputId, iconElement) {
    const input = document.getElementById(inputId);
    if(input.type === "password") {
        input.type = "text";
        iconElement.classList.replace('fa-eye-slash', 'fa-eye');
    } else {
        input.type = "password";
        iconElement.classList.replace('fa-eye', 'fa-eye-slash');
    }
}

// 1. असली रजिस्ट्रेशन हैंडलर (डेटाबेस में नया यूजर जोड़ने के लिए)
async function processRegister(event) {
    event.preventDefault();
    let phone = document.getElementById('reg-phone')?.value.trim() || document.querySelector('#register-screen input[type="tel"]')?.value.trim();
    let pass = document.getElementById('reg-pass')?.value.trim();
    let confirmPass = document.getElementById('reg-confirm')?.value.trim();
    let inviteCode = document.getElementById('reg-invite')?.value.trim() || "";

    if (!phone || phone.length < 10) {
        showAuthAlert("Invalid Number", "Please enter a valid 10-digit mobile number!", "❌");
        return;
    }
    if (!pass || pass.length < 6) {
        showAuthAlert("Weak Password", "Password must be at least 6 characters long!", "❌");
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
            showAuthAlert("Success", "Registration Successful! Moving to Login Page.", "✅", () => {
                showScreen('login-screen');
                const loginInput = document.querySelector('#login-screen input[type="tel"]');
                if(loginInput) loginInput.value = phone;
            });
        } else {
            showAuthAlert("Registration Failed", data.message || "Failed to create account.", "❌");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Unable to connect to the game server. Please check backend logs!", "⚠️");
    }
}
// 2. असली लॉगिन हैंडलर (पुराना डेटा उठाकर home.html पर भेजने के लिए)
async function processLogin(event) {
    event.preventDefault();
    let phone = document.querySelector('#login-screen input[type="tel"]')?.value.trim();
    let password = document.getElementById('login-pass')?.value.trim();

    if (!phone) {
        showAuthAlert("Input Required", "Please enter your registered phone number!", "❌");
        return;
    }
    if (!password) {
        showAuthAlert("Input Required", "Please enter your account password!", "❌");
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
            showAuthAlert("Welcome Back", "Login Successful! Opening your game room...", "✅", () => {
                // यूजर का फोन नंबर और बैलेंस लोकल स्टोरेज में सेव करना
                localStorage.setItem('user_phone', data.phone || phone);
                // सीधे home.html पेज पर सुरक्षित ट्रांसफर
                window.location.href = "home.html";
            });
        } else {
            showAuthAlert("Authentication Failed", data.message || "Invalid credentials. Please try again.", "❌");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Unable to connect to the game server. Checking local testing backup...", "⚠️", () => {
            // बैकअप रिडायरेक्शन ताकि बिना सर्वर के भी टेस्टिंग न रुके
            localStorage.setItem('user_phone', phone);
            window.location.href = "home.html";
        });
    }
}

// अगर कोई लिंक से आए (जैसे: index.html?ref=1234567890) तो इनवाइट कोड अपने आप भरने का लॉजिक
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    const inviteInput = document.getElementById('reg-invite');
    
    if (inviteInput && refCode) {
        let cleanRef = refCode.trim();
        if (cleanRef !== "" && cleanRef !== "null" && cleanRef !== "undefined") {
            inviteInput.value = cleanRef;
            inviteInput.readOnly = true; // रेफरल कोड को कोई बदल न सके
        }
    }
});

function goToHome() {
    window.location.href = "home.html";
}
