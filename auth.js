const API_URL = "http://localhost:3000";

//      (     )
let redirectAction = null;

function showAuthAlert(title, message, icon = '', action = null) {
    document.getElementById("authAlertIcon").innerText = icon;
    document.getElementById("authAlertTitle").innerText = title;
    document.getElementById("authAlertMessage").innerText = message;
    redirectAction = action;
    document.getElementById("authAlert").classList.add("show");
}

function closeAuthAlert() {
    document.getElementById("authAlert").classList.remove("show");
    if (typeof redirectAction === 'function') {
        redirectAction();
    }
}

//      
function showSection(type) {
    if (type === 'login') {
        document.getElementById('login-section').classList.add('active');
        document.getElementById('register-section').classList.remove('active');
    } else if (type === 'register') {
        document.getElementById('register-section').classList.add('active');
        document.getElementById('login-section').classList.remove('active');
    }
}

function switchLoginTab(type) {
    let tabPhone = document.getElementById('tab-phone');
    let tabEmail = document.getElementById('tab-email');
    let label = document.getElementById('login-label');
    let cc = document.getElementById('login-cc');
    let input = document.getElementById('login-user');
    
    if (type === 'phone') {
        tabPhone.classList.add('active');
        tabEmail.classList.remove('active');
        label.innerText = " Phone number";
        cc.style.display = "block";
        input.placeholder = "Please enter the phone number";
        input.type = "number";
    } else {
        tabEmail.classList.add('active');
        tabPhone.classList.remove('active');
        label.innerText = " Email / Account";
        cc.style.display = "none";
        input.placeholder = "Please enter the email address";
        input.type = "text";
    }
}

function togglePassword(inputId) {
    let input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}

//    -     
async function handleRegister(event) {
    event.preventDefault();
    let phone = document.getElementById('reg-phone').value.trim();
    let pass = document.getElementById('reg-pass').value.trim();
    let confirmPass = document.getElementById('reg-confirm').value.trim();
    
    if (phone.length < 10) { 
        showAuthAlert("Invalid Number", "Please enter a valid 10-digit mobile number!", ""); 
        return; 
    }
    if (pass.length < 6) { 
        showAuthAlert("Weak Password", "Password must be at least 6 characters long!", ""); 
        return; 
    }
    if (pass !== confirmPass) { 
        showAuthAlert("Mismatch Error", "Passwords do not match! Please check again.", ""); 
        return; 
    }
    
    try {
        let response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password: pass })
        });
        let data = await response.json();
        
        if (data.success) {
            showAuthAlert("Success", "Registration Successful! Moving to Login Page.", "", () => {
                document.getElementById('register-form').reset();
                showSection('login');
                switchLoginTab('phone');
                document.getElementById('login-user').value = phone;
            });
        } else {
            showAuthAlert("Registration Failed", data.message || "Failed to create account.", "");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Unable to connect to the server. Please check your Termux environment!", "");
    }
}

//    -     
async function handleLogin(event) {
    event.preventDefault();
    let phone = document.getElementById('login-user').value.trim();
    let password = document.getElementById('login-pass').value.trim();
    
    if (!phone) {
        showAuthAlert("Input Required", "Please enter your registered phone number or email!", "");
        return;
    }
    if (!password) {
        showAuthAlert("Input Required", "Please enter your account password!", "");
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
            showAuthAlert("Welcome Back", "Login Successful! Opening your game room...", "", () => {
                localStorage.setItem('user_phone', data.phone);
                window.location.href = "home.html";
            });
        } else {
            showAuthAlert("Authentication Failed", data.message || "Invalid credentials. Please try again.", "");
        }
    } catch (error) {
        showAuthAlert("Server Error", "Unable to connect to the server. Please check your Termux environment!", "");
    }
}
