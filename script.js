import { auth, db, storage } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";


/* ==========================================
   1. GLOBAL VARIABLES
========================================== */

let currentUser = null;
let currentProfile = null;

let activeConversationId = null;
let activeChatUser = null;

let selectedFriendProfile = null;

let unsubscribeMessages = null;
let unsubscribeConversations = null;
let unsubscribeNotifications = null;


/* ==========================================
   2. GENERAL HELPER FUNCTIONS
========================================== */

function getElement(id) {
    return document.getElementById(id);
}


function showMessage(id, message, success = false) {
    const element = getElement(id);

    if (!element) return;

    element.textContent = message;

    element.style.color = success ? "green" : "red";
}


function normaliseUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");
}


function getDefaultPhoto() {
    return "https://placehold.co/100x100/222222/ffffff?text=User";
}


function getPhoto(profile) {
    return profile?.photoURL || getDefaultPhoto();
}


function formatDate(timestamp) {
    if (!timestamp) return "";

    const date = timestamp.toDate
        ? timestamp.toDate()
        : new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleString();
}


function getErrorMessage(error) {
    console.error("NovaChat error:", error);

    const messages = {
        "auth/email-already-in-use":
            "This email address is already registered.",

        "auth/invalid-email":
            "Please enter a valid email address.",

        "auth/weak-password":
            "Your password must contain at least 6 characters.",

        "auth/invalid-credential":
            "Incorrect email or password.",

        "auth/user-not-found":
            "No account was found with these details.",

        "auth/wrong-password":
            "Incorrect email or password.",

        "auth/network-request-failed":
            "Network error. Check your internet connection.",

        "auth/too-many-requests":
            "Too many attempts. Please try again later.",

        "permission-denied":
            "Firebase denied this action. Check your Firestore rules.",

        "storage/unauthorized":
            "Image upload was denied. Check your Firebase Storage rules."
    };

    return messages[error.code] ||
        error.message ||
        "Something went wrong. Please try again.";
}


function setButtonLoading(button, loading, loadingText, normalText) {
    if (!button) return;

    button.disabled = loading;

    button.textContent = loading
        ? loadingText
        : normalText;
}


/* ==========================================
   3. PAGE NAVIGATION
========================================== */

function showPage(pageId) {
    const target = getElement(pageId);

    if (!target) {
        console.error("Page not found in HTML:", pageId);
        return;
    }

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
        page.style.display = "none";
    });

    target.classList.add("active");
    target.style.display = "block";

    const navbar = getElement("main-navbar");
    const footer = getElement("main-footer");

    const isLandingPage = pageId === "landing-page";

    if (navbar) {
        navbar.style.display = isLandingPage ? "flex" : "none";
    }

    if (footer) {
        footer.style.display = isLandingPage ? "block" : "none";
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


function openLanding() {
    showPage("landing-page");
}


function openLogin() {
    showPage("login-section");
}


function openRegister() {
    showPage("register-section");
}


function openForgotPassword() {
    if (getElement("forgot-password-section")) {
        showPage("forgot-password-section");
    } else {
        alert("The password recovery page is not present in your HTML.");
    }
}


function openDashboard() {
    if (!currentUser) {
        openLogin();
        return;
    }

    showPage("dashboard");

    loadDashboard();
}


/* ==========================================
   4. PROFILE PHOTO UPLOAD
========================================== */

async function uploadProfilePhoto(file, userId) {
    if (!file) {
        return "";
    }

    if (!file.type.startsWith("image/")) {
        throw new Error("Please select an image file.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Your image must be smaller than 5 MB.");
    }

    const safeName = file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
    );

    const imageRef = ref(
        storage,
        `profilePhotos/${userId}/${Date.now()}_${safeName}`
    );

    await uploadBytes(imageRef, file);

    return await getDownloadURL(imageRef);
}


/* ==========================================
   5. REGISTER ACCOUNT
========================================== */

const registerForm = getElement("register-form");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const fullName = getElement("full-name")?.value.trim() || "";

        const username = normaliseUsername(
            getElement("username")?.value
        );

        const email = getElement("register-email")?.value.trim() || "";

        const password = getElement("register-password")?.value || "";

        const confirmPassword =
            getElement("confirm-password")?.value || "";

        const imageFile =
            getElement("profile-image")?.files?.[0] || null;

        const submitButton = registerForm.querySelector(
            'button[type="submit"]'
        );

        if (!fullName) {
            showMessage("register-message", "Enter your full name.");
            return;
        }

        if (username.length < 3) {
            showMessage(
                "register-message",
                "Your username must contain at least 3 characters."
            );
            return;
        }

        if (!email) {
            showMessage(
                "register-message",
                "Enter your email address. Email/password registration is required by this version."
            );
            return;
        }

        if (password.length < 6) {
            showMessage(
                "register-message",
                "Your password must contain at least 6 characters."
            );
            return;
        }

        if (password !== confirmPassword) {
            showMessage(
                "register-message",
                "Your passwords do not match."
            );
            return;
        }

        setButtonLoading(
            submitButton,
            true,
            "Creating account...",
            "Create Account"
        );

        showMessage(
            "register-message",
            "Checking your username...",
            true
        );

        try {
            const usernameRef = doc(db, "usernames", username);

            const usernameSnapshot = await getDoc(usernameRef);

            if (usernameSnapshot.exists()) {
                showMessage(
                    "register-message",
                    "This username is already taken."
                );
                return;
            }

            const credential = await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

            const user = credential.user;

            let photoURL = "";

            if (imageFile) {
                photoURL = await uploadProfilePhoto(
                    imageFile,
                    user.uid
                );
            }

            await updateProfile(user, {
                displayName: fullName,
                photoURL: photoURL || null
            });

            const profile = {
                uid: user.uid,
                fullName: fullName,
                username: username,
                email: email,
                photoURL: photoURL,
                bio: "",
                createdAt: serverTimestamp()
            };

            await setDoc(
                doc(db, "users", user.uid),
                profile
            );

            await setDoc(
                doc(db, "publicProfiles", user.uid),
                {
                    uid: user.uid,
                    fullName: fullName,
                    username: username,
                    photoURL: photoURL,
                    bio: ""
                }
            );

            await setDoc(usernameRef, {
                uid: user.uid,
                username: username
            });

            currentUser = user;
            currentProfile = profile;

            showMessage(
                "register-message",
                "Account created successfully!",
                true
            );

            openDashboard();

        } catch (error) {
            showMessage(
                "register-message",
                getErrorMessage(error)
            );

        } finally {
            setButtonLoading(
                submitButton,
                false,
                "Creating account...",
                "Create Account"
            );
        }
    });
}


/* ==========================================
   6. LOGIN
========================================== */

const loginForm = getElement("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const email =
            getElement("login-email")?.value.trim() || "";

        const password =
            getElement("login-password")?.value || "";

        const submitButton = loginForm.querySelector(
            'button[type="submit"]'
        );

        setButtonLoading(
            submitButton,
            true,
            "Logging in...",
            "Login"
        );

        showMessage(
            "login-message",
            "Checking your account...",
            true
        );

        try {
            const credential = await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

            currentUser = credential.user;

            await loadUserProfile(credential.user);

            showMessage(
                "login-message",
                "Login successful!",
                true
            );

            openDashboard();

        } catch (error) {
            showMessage(
                "login-message",
                getErrorMessage(error)
            );

        } finally {
            setButtonLoading(
                submitButton,
                false,
                "Logging in...",
                "Login"
            );
        }
    });
}


/* ==========================================
   7. LOAD USER PROFILE
========================================== */

async function loadUserProfile(user) {
    const profileRef = doc(db, "users", user.uid);

    const profileSnapshot = await getDoc(profileRef);

    if (profileSnapshot.exists()) {
        currentProfile = profileSnapshot.data();

        return currentProfile;
    }

    const recoveredProfile = {
        uid: user.uid,
        fullName: user.displayName || "NovaChat User",
        username: "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        bio: ""
    };

    await setDoc(profileRef, recoveredProfile);

    await setDoc(
        doc(db, "publicProfiles", user.uid),
        {
            uid: user.uid,
            fullName: recoveredProfile.fullName,
            username: "",
            photoURL: recoveredProfile.photoURL,
            bio: ""
        }
    );

    currentProfile = recoveredProfile;

    return currentProfile;
}


/* ==========================================
   8. DASHBOARD
========================================== */

async function loadDashboard() {
    if (!currentUser) return;

    try {
        if (!currentProfile) {
            await loadUserProfile(currentUser);
        }

        if (!currentProfile) return;

        const welcomeName = getElement("welcome-name");
        const username = getElement("dashboard-username");
        const email = getElement("dashboard-email");
        const photo = getElement("dashboard-photo");

        if (welcomeName) {
            welcomeName.textContent =
                currentProfile.fullName || "User";
        }

        if (username) {
            username.textContent = currentProfile.username
                ? "@" + currentProfile.username
                : "Choose a username in your profile";
        }

        if (email) {
            email.textContent =
                currentProfile.email || currentUser.email || "";
        }

        if (photo) {
            photo.src = getPhoto(currentProfile);
        }

        loadNotifications();
        loadConversationList();

    } catch (error) {
        console.error("Dashboard error:", error);
    }
}


/* ==========================================
   9. LOGOUT
========================================== */

async function logoutUser() {
    try {
        stopRealtimeListeners();

        await signOut(auth);

        currentUser = null;
        currentProfile = null;

        activeConversationId = null;
        activeChatUser = null;

        selectedFriendProfile = null;

        openLanding();

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


/* ==========================================
   10. FIND FRIENDS
========================================== */

const friendsSearchForm = getElement("friends-search-form");

if (friendsSearchForm) {
    friendsSearchForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            openLogin();
            return;
        }

        const searchTerm = normaliseUsername(
            getElement("friends-search-input")?.value
        );

        const resultsContainer = getElement("friends-list");

        if (!searchTerm) {
            showMessage(
                "friends-search-message",
                "Enter a username to search."
            );
            return;
        }

        if (resultsContainer) {
            resultsContainer.innerHTML = "";
        }

        showMessage(
            "friends-search-message",
            "Searching...",
            true
        );

        try {
            let profiles = [];

            const usernameSnapshot = await getDoc(
                doc(db, "usernames", searchTerm)
            );

            if (usernameSnapshot.exists()) {
                const userId = usernameSnapshot.data().uid;

                if (userId && userId !== currentUser.uid) {
                    const profileSnapshot = await getDoc(
                        doc(db, "publicProfiles", userId)
                    );

                    if (profileSnapshot.exists()) {
                        profiles.push(profileSnapshot.data());
                    }
                }
            }

            if (profiles.length === 0) {
                const profilesQuery = query(
                    collection(db, "publicProfiles"),
                    where("username", "==", searchTerm)
                );

                const result = await getDocs(profilesQuery);

                result.forEach(profileDoc => {
                    const profile = profileDoc.data();

                    if (profile.uid !== currentUser.uid) {
                        profiles.push(profile);
                    }
                });
            }

            if (!resultsContainer) return;

            resultsContainer.innerHTML = "";

            if (profiles.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="friends-empty">
                        <h3>No user found</h3>
                        <p>Check the username and try again.</p>
                    </div>
                `;

                showMessage(
                    "friends-search-message",
                    "No matching user was found."
                );

                return;
            }

            profiles.forEach(displaySearchResult);

            showMessage(
                "friends-search-message",
                `${profiles.length} user found.`,
                true
            );

        } catch (error) {
            showMessage(
                "friends-search-message",
                getErrorMessage(error)
            );
        }
    });
}


function displaySearchResult(profile) {
    const container = getElement("friends-list");

    if (!container) return;

    const card = document.createElement("div");

    card.className = "friend-result-card";

    const photo = document.createElement("img");

    photo.src = getPhoto(profile);
    photo.alt = "Profile picture";

    const details = document.createElement("div");

    const name = document.createElement("h3");

    name.textContent = profile.fullName || "NovaChat User";

    const username = document.createElement("p");

    username.textContent = profile.username
        ? "@" + profile.username
        : "";

    const button = document.createElement("button");

    button.type = "button";
    button.textContent = "View Profile";

    button.addEventListener("click", function () {
        openFriendProfile(profile);
    });

    details.append(name, username, button);

    card.append(photo, details);

    container.appendChild(card);
}


/* ==========================================
   11. VIEW FRIEND PROFILE
========================================== */

function openFriendProfile(profile) {
    if (!profile) return;

    selectedFriendProfile = profile;

    const photo = getElement("friend-profile-photo");
    const name = getElement("friend-profile-name");
    const username = getElement("friend-profile-username");
    const bio = getElement("friend-profile-bio");
    const popup = getElement("friend-profile");
    const addButton = getElement("send-friend-request-btn");

    if (photo) {
        photo.src = getPhoto(profile);
    }

    if (name) {
        name.textContent = profile.fullName || "NovaChat User";
    }

    if (username) {
        username.textContent = profile.username
            ? "@" + profile.username
            : "";
    }

    if (bio) {
        bio.textContent = profile.bio || "NovaChat community member.";
    }

    if (popup) {
        popup.style.display = "block";
        popup.classList.add("active");
    }

    if (addButton) {
        addButton.disabled = false;
        addButton.textContent = "Add Friend";
    }
}


window.openFriendProfile = openFriendProfile;


const closeFriendProfileButton = getElement("close-friend-profile");

if (closeFriendProfileButton) {
    closeFriendProfileButton.addEventListener("click", function () {
        const popup = getElement("friend-profile");

        if (popup) {
            popup.style.display = "none";
            popup.classList.remove("active");
        }

        selectedFriendProfile = null;
    });
}


/* ==========================================
   12. SEND FRIEND REQUEST
========================================== */

const sendFriendRequestButton =
    getElement("send-friend-request-btn");

if (sendFriendRequestButton) {
    sendFriendRequestButton.addEventListener("click", async function () {
        if (!currentUser) {
            openLogin();
            return;
        }

        if (!selectedFriendProfile) {
            alert("Select a user first.");
            return;
        }

        const friend = selectedFriendProfile;

        if (friend.uid === currentUser.uid) {
            alert("You cannot add yourself as a friend.");
            return;
        }

        setButtonLoading(
            sendFriendRequestButton,
            true,
            "Sending...",
            "Add Friend"
        );

        try {
            const friendshipId = [
                currentUser.uid,
                friend.uid
            ].sort().join("_");

            const friendshipSnapshot = await getDoc(
                doc(db, "friendships", friendshipId)
            );

            if (friendshipSnapshot.exists()) {
                alert("You are already friends.");
                return;
            }

            const requestsQuery = query(
                collection(db, "friendRequests"),
                where("fromUid", "==", currentUser.uid),
                where("toUid", "==", friend.uid),
                where("status", "==", "pending")
            );

            const requestsSnapshot = await getDocs(requestsQuery);

            if (!requestsSnapshot.empty) {
                alert("You have already sent this friend request.");
                return;
            }

            const requestRef = await addDoc(
                collection(db, "friendRequests"),
                {
                    fromUid: currentUser.uid,
                    toUid: friend.uid,
                    status: "pending",
                    createdAt: serverTimestamp()
                }
            );

            await addDoc(
                collection(db, "notifications"),
                {
                    senderId: currentUser.uid,
                    userId: friend.uid,
                    type: "friend_request",
                    message:
                        `${currentProfile?.fullName || "Someone"} sent you a friend request.`,
                    read: false,
                    createdAt: serverTimestamp(),
                    requestId: requestRef.id
                }
            );

            sendFriendRequestButton.textContent = "Request Sent";

            alert("Friend request sent successfully.");

        } catch (error) {
            alert(getErrorMessage(error));

            sendFriendRequestButton.disabled = false;
            sendFriendRequestButton.textContent = "Add Friend";

        } finally {
            if (
                sendFriendRequestButton.textContent !== "Request Sent"
            ) {
                sendFriendRequestButton.disabled = false;
            }
        }
    });
}


/* ==========================================
   13. LOAD FRIEND REQUESTS
========================================== */

async function loadFriendRequests() {
    if (!currentUser) return;

    const container = getElement("friend-requests-list");

    if (!container) return;

    container.innerHTML = "<p>Loading friend requests...</p>";

    try {
        const requestsQuery = query(
            collection(db, "friendRequests"),
            where("toUid", "==", currentUser.uid),
            where("status", "==", "pending")
        );

        const snapshot = await getDocs(requestsQuery);

        container.innerHTML = "";

        if (snapshot.empty) {
            container.innerHTML =
                '<p class="empty-message">No friend requests yet.</p>';

            return;
        }

        for (const requestDoc of snapshot.docs) {
            const request = requestDoc.data();

            const profileSnapshot = await getDoc(
                doc(db, "publicProfiles", request.fromUid)
            );

            const profile = profileSnapshot.exists()
                ? profileSnapshot.data()
                : {
                    uid: request.fromUid,
                    fullName: "NovaChat User",
                    username: ""
                };

            const card = document.createElement("div");

            card.className = "friend-request-card";

            const name = document.createElement("h3");

            name.textContent = profile.fullName || "NovaChat User";

            const username = document.createElement("p");

            username.textContent = profile.username
                ? "@" + profile.username
                : "";

            const acceptButton = document.createElement("button");

            acceptButton.type = "button";
            acceptButton.textContent = "Accept";

            acceptButton.addEventListener("click", async function () {
                await respondToFriendRequest(
                    requestDoc.id,
                    request,
                    "accepted"
                );
            });

            const rejectButton = document.createElement("button");

            rejectButton.type = "button";
            rejectButton.textContent = "Reject";

            rejectButton.addEventListener("click", async function () {
                await respondToFriendRequest(
                    requestDoc.id,
                    request,
                    "rejected"
                );
            });

            card.append(
                name,
                username,
                acceptButton,
                rejectButton
            );

            container.appendChild(card);
        }

    } catch (error) {
        container.textContent = getErrorMessage(error);
    }
}


/* ==========================================
   14. ACCEPT OR REJECT REQUEST
========================================== */

async function respondToFriendRequest(
    requestId,
    request,
    response
) {
    try {
        // Update only the status field to avoid changing
        // additional fields that your Firestore rules may reject.

        await updateDoc(
            doc(db, "friendRequests", requestId),
            {
                status: response
            }
        );

        if (response === "accepted") {
            const friendshipId = [
                request.fromUid,
                request.toUid
            ].sort().join("_");

            await setDoc(
                doc(db, "friendships", friendshipId),
                {
                    users: [
                        request.fromUid,
                        request.toUid
                    ],
                    createdAt: serverTimestamp()
                }
            );

            // Notify the person who sent the request.
            await addDoc(
                collection(db, "notifications"),
                {
                    senderId: currentUser.uid,
                    userId: request.fromUid,
                    type: "friend_accepted",
                    message:
                        `${currentProfile?.fullName || "Someone"} accepted your friend request.`,
                    read: false,
                    createdAt: serverTimestamp()
                }
            );
        }

        await loadFriendRequests();
        await loadMyFriends();

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


/* ==========================================
   15. LOAD MY FRIENDS
========================================== */

async function loadMyFriends() {
    if (!currentUser) return;

    const container = getElement("my-friends-list");

    if (!container) return;

    container.innerHTML = "<p>Loading friends...</p>";

    try {
        const friendsQuery = query(
            collection(db, "friendships"),
            where("users", "array-contains", currentUser.uid)
        );

        const snapshot = await getDocs(friendsQuery);

        container.innerHTML = "";

        if (snapshot.empty) {
            container.innerHTML =
                '<p class="empty-message">You have no friends yet.</p>';

            return;
        }

        for (const friendshipDoc of snapshot.docs) {
            const friendship = friendshipDoc.data();

            const friendUid = friendship.users?.find(
                uid => uid !== currentUser.uid
            );

            if (!friendUid) continue;

            const profileSnapshot = await getDoc(
                doc(db, "publicProfiles", friendUid)
            );

            if (!profileSnapshot.exists()) continue;

            const profile = profileSnapshot.data();

            const card = document.createElement("div");

            card.className = "friend-card";

            const photo = document.createElement("img");

            photo.src = getPhoto(profile);
            photo.alt = "Friend profile picture";

            const name = document.createElement("h3");

            name.textContent = profile.fullName || "NovaChat User";

            const username = document.createElement("p");

            username.textContent = profile.username
                ? "@" + profile.username
                : "";

            const messageButton = document.createElement("button");

            messageButton.type = "button";
            messageButton.textContent = "Message";

            messageButton.addEventListener("click", function () {
                openConversation(profile);
            });

            card.append(
                photo,
                name,
                username,
                messageButton
            );

            container.appendChild(card);
        }

    } catch (error) {
        container.textContent = getErrorMessage(error);
    }
}


/* ==========================================
   16. CONVERSATION LIST
========================================== */

function loadConversationList() {
    if (!currentUser) return;

    const container = getElement("conversation-list");

    if (!container) return;

    if (unsubscribeConversations) {
        unsubscribeConversations();
        unsubscribeConversations = null;
    }

    const conversationsQuery = query(
        collection(db, "conversations"),
        where("participants", "array-contains", currentUser.uid)
    );

    unsubscribeConversations = onSnapshot(
        conversationsQuery,

        async snapshot => {
            container.innerHTML = "";

            if (snapshot.empty) {
                container.innerHTML = `
                    <p class="empty-message">
                        No conversations yet. Find a friend to start chatting.
                    </p>
                `;

                return;
            }

            for (const conversationDoc of snapshot.docs) {
                const conversation = conversationDoc.data();

                const otherUid = conversation.participants?.find(
                    uid => uid !== currentUser.uid
                );

                if (!otherUid) continue;

                const profileSnapshot = await getDoc(
                    doc(db, "publicProfiles", otherUid)
                );

                if (!profileSnapshot.exists()) continue;

                const profile = profileSnapshot.data();

                const button = document.createElement("button");

                button.type = "button";
                button.className = "conversation-item";

                button.textContent =
                    profile.fullName || "NovaChat User";

                button.addEventListener("click", function () {
                    openConversation(
                        profile,
                        conversationDoc.id
                    );
                });

                container.appendChild(button);
            }
        },

        error => {
            console.error("Conversation list error:", error);

            container.textContent = getErrorMessage(error);
        }
    );
}


/* ==========================================
   17. OPEN CONVERSATION
========================================== */

async function openConversation(
    profile,
    existingConversationId = null
) {
    if (!currentUser) {
        openLogin();
        return;
    }

    if (!profile?.uid) {
        alert("This user's profile is unavailable.");
        return;
    }

    if (profile.uid === currentUser.uid) {
        alert("You cannot message yourself.");
        return;
    }

    try {
        const conversationId = existingConversationId ||
            [
                currentUser.uid,
                profile.uid
            ].sort().join("_");

        const conversationRef = doc(
            db,
            "conversations",
            conversationId
        );

        const conversationSnapshot = await getDoc(
            conversationRef
        );

        if (!conversationSnapshot.exists()) {
            await setDoc(
                conversationRef,
                {
                    participants: [
                        currentUser.uid,
                        profile.uid
                    ],
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }
            );
        }

        activeConversationId = conversationId;
        activeChatUser = profile;

        const photo = getElement("chat-user-photo");
        const name = getElement("chat-user-name");
        const username = getElement("chat-user-username");

        if (photo) {
            photo.src = getPhoto(profile);
        }

        if (name) {
            name.textContent = profile.fullName || "NovaChat User";
        }

        if (username) {
            username.textContent = profile.username
                ? "@" + profile.username
                : "";
        }

        showPage("chat-page");

        listenForMessages(conversationId);

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


window.openConversation = openConversation;


/* ==========================================
   18. REAL-TIME MESSAGES
========================================== */

function listenForMessages(conversationId) {
    if (unsubscribeMessages) {
        unsubscribeMessages();
        unsubscribeMessages = null;
    }

    const container = getElement("messages-container");

    if (!container) return;

    container.innerHTML = "<p>Loading messages...</p>";

    const messagesQuery = query(
        collection(
            db,
            "conversations",
            conversationId,
            "messages"
        ),
        orderBy("createdAt", "asc")
    );

    unsubscribeMessages = onSnapshot(
        messagesQuery,

        snapshot => {
            container.innerHTML = "";

            if (snapshot.empty) {
                container.innerHTML = `
                    <p class="empty-message">
                        No messages yet. Say hello!
                    </p>
                `;

                return;
            }

            snapshot.forEach(messageDoc => {
                const message = messageDoc.data();

                const bubble = document.createElement("div");

                bubble.className =
                    message.senderId === currentUser.uid
                        ? "message sent"
                        : "message received";

                const text = document.createElement("p");

                text.textContent = message.text || "";

                const time = document.createElement("small");

                time.textContent = formatDate(message.createdAt);

                bubble.append(text, time);

                container.appendChild(bubble);
            });

            container.scrollTop = container.scrollHeight;
        },

        error => {
            console.error("Messages error:", error);

            container.textContent = getErrorMessage(error);
        }
    );
}


/* ==========================================
   19. SEND MESSAGE
========================================== */

const messageForm = getElement("message-form");

if (messageForm) {
    messageForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser || !activeConversationId || !activeChatUser) {
            showMessage(
                "chat-message-status",
                "Open a conversation before sending a message."
            );

            return;
        }

        const input = getElement("message-input");

        const messageText = input?.value.trim() || "";

        if (!messageText) return;

        const sendButton = getElement("send-message-btn");

        if (sendButton) {
            sendButton.disabled = true;
        }

        try {
            await addDoc(
                collection(
                    db,
                    "conversations",
                    activeConversationId,
                    "messages"
                ),
                {
                    text: messageText,
                    senderId: currentUser.uid,
                    receiverId: activeChatUser.uid,
                    createdAt: serverTimestamp()
                }
            );

            await updateDoc(
                doc(db, "conversations", activeConversationId),
                {
                    updatedAt: serverTimestamp()
                }
            );

            input.value = "";

            showMessage(
                "chat-message-status",
                "Message sent.",
                true
            );

        } catch (error) {
            showMessage(
                "chat-message-status",
                getErrorMessage(error)
            );

        } finally {
            if (sendButton) {
                sendButton.disabled = false;
            }

            input?.focus();
        }
    });
}


/* ==========================================
   20. NOTIFICATIONS
========================================== */

function loadNotifications() {
    if (!currentUser) return;

    if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }

    const notificationsQuery = query(
        collection(db, "notifications"),
        where("userId", "==", currentUser.uid)
    );

    unsubscribeNotifications = onSnapshot(
        notificationsQuery,

        snapshot => {
            const container = getElement("notifications-list");
            const badge = getElement("notification-count");

            let unreadCount = 0;

            snapshot.forEach(notificationDoc => {
                if (!notificationDoc.data().read) {
                    unreadCount++;
                }
            });

            if (badge) {
                badge.textContent = unreadCount;
                badge.style.display = unreadCount > 0
                    ? "inline-block"
                    : "none";
            }

            if (!container) return;

            container.innerHTML = "";

            if (snapshot.empty) {
                container.innerHTML = `
                    <p class="empty-message">
                        You do not have any notifications yet.
                    </p>
                `;

                return;
            }

            const notifications = [...snapshot.docs].sort(
                (a, b) => {
                    const timeA = a.data().createdAt?.seconds || 0;
                    const timeB = b.data().createdAt?.seconds || 0;

                    return timeB - timeA;
                }
            );

            notifications.forEach(notificationDoc => {
                const notification = notificationDoc.data();

                const card = document.createElement("div");

                card.className = "notification-card";

                const message = document.createElement("p");

                message.textContent =
                    notification.message || "New notification";

                const time = document.createElement("small");

                time.textContent = formatDate(notification.createdAt);

                if (!notification.read) {
                    card.style.fontWeight = "bold";
                }

                card.append(message, time);

                container.appendChild(card);
            });
        },

        error => {
            console.error("Notification error:", error);
        }
    );
}


/* ==========================================
   21. MARK NOTIFICATIONS AS READ
========================================== */

const markAllReadButton = getElement("mark-all-read-btn");

if (markAllReadButton) {
    markAllReadButton.addEventListener("click", async function () {
        if (!currentUser) return;

        setButtonLoading(
            markAllReadButton,
            true,
            "Updating...",
            "Mark all as read"
        );

        try {
            const notificationsQuery = query(
                collection(db, "notifications"),
                where("userId", "==", currentUser.uid)
            );

            const snapshot = await getDocs(notificationsQuery);

            for (const notificationDoc of snapshot.docs) {
                if (!notificationDoc.data().read) {
                    await updateDoc(
                        notificationDoc.ref,
                        {
                            read: true
                        }
                    );
                }
            }

            alert("Notifications marked as read.");

        } catch (error) {
            alert(getErrorMessage(error));

        } finally {
            setButtonLoading(
                markAllReadButton,
                false,
                "Updating...",
                "Mark all as read"
            );
        }
    });
}


/* ==========================================
   22. EDIT PROFILE
========================================== */

function fillProfileForm() {
    if (!currentProfile) return;

    const fullName = getElement("edit-full-name");
    const username = getElement("edit-username");
    const bio = getElement("edit-bio");
    const preview = getElement("edit-profile-preview");

    if (fullName) {
        fullName.value = currentProfile.fullName || "";
    }

    if (username) {
        username.value = currentProfile.username || "";
    }

    if (bio) {
        bio.value = currentProfile.bio || "";
    }

    if (preview) {
        preview.src = getPhoto(currentProfile);
    }
}


// This is the only openProfile function in this file.

function openProfile() {
    if (!currentUser) {
        openLogin();
        return;
    }

    fillProfileForm();

    showPage("edit-profile-page");
}


const editProfileForm = getElement("edit-profile-form");

if (editProfileForm) {
    editProfileForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser || !currentProfile) {
            alert("Please log in again.");
            return;
        }

        const fullName =
            getElement("edit-full-name")?.value.trim() || "";

        const username = normaliseUsername(
            getElement("edit-username")?.value
        );

        const bio =
            getElement("edit-bio")?.value.trim() || "";

        const imageFile =
            getElement("edit-profile-image")?.files?.[0] || null;

        const saveButton = getElement("save-profile-btn");

        if (!fullName) {
            showMessage("profile-message", "Enter your full name.");
            return;
        }

        if (username.length < 3) {
            showMessage(
                "profile-message",
                "Your username must contain at least 3 characters."
            );

            return;
        }

        setButtonLoading(
            saveButton,
            true,
            "Saving...",
            "Save Profile"
        );

        showMessage(
            "profile-message",
            "Saving your profile...",
            true
        );

        try {
            const oldUsername = currentProfile.username || "";

            if (username !== oldUsername) {
                const usernameSnapshot = await getDoc(
                    doc(db, "usernames", username)
                );

                if (usernameSnapshot.exists()) {
                    const owner = usernameSnapshot.data().uid;

                    if (owner !== currentUser.uid) {
                        showMessage(
                            "profile-message",
                            "That username is already taken."
                        );

                        return;
                    }
                }
            }

            let photoURL = currentProfile.photoURL || "";

            if (imageFile) {
                photoURL = await uploadProfilePhoto(
                    imageFile,
                    currentUser.uid
                );
            }

            const updatedProfile = {
                uid: currentUser.uid,
                fullName: fullName,
                username: username,
                email: currentUser.email || "",
                bio: bio,
                photoURL: photoURL
            };

            await updateDoc(
                doc(db, "users", currentUser.uid),
                {
                    fullName: fullName,
                    username: username,
                    bio: bio,
                    photoURL: photoURL
                }
            );

            await setDoc(
                doc(db, "publicProfiles", currentUser.uid),
                {
                    uid: currentUser.uid,
                    fullName: fullName,
                    username: username,
                    bio: bio,
                    photoURL: photoURL
                }
            );

            if (username !== oldUsername) {
                await setDoc(
                    doc(db, "usernames", username),
                    {
                        uid: currentUser.uid,
                        username: username
                    }
                );

                // Delete the old username only if it still belongs
                // to the signed-in user.
                if (oldUsername) {
                    const oldUsernameRef = doc(
                        db,
                        "usernames",
                        oldUsername
                    );

                    const oldUsernameSnapshot = await getDoc(
                        oldUsernameRef
                    );

                    if (
                        oldUsernameSnapshot.exists() &&
                        oldUsernameSnapshot.data().uid === currentUser.uid
                    ) {
                        await setDoc(
                            oldUsernameRef,
                            {
                                uid: currentUser.uid,
                                username: oldUsername,
                                available: false
                            }
                        );
                    }
                }
            }

            await updateProfile(currentUser, {
                displayName: fullName,
                photoURL: photoURL || null
            });

            currentProfile = {
                ...currentProfile,
                ...updatedProfile
            };

            fillProfileForm();

            await loadDashboard();

            showMessage(
                "profile-message",
                "Profile updated successfully!",
                true
            );

        } catch (error) {
            showMessage(
                "profile-message",
                getErrorMessage(error)
            );

        } finally {
            setButtonLoading(
                saveButton,
                false,
                "Saving...",
                "Save Profile"
            );
        }
    });
}


/* ==========================================
   23. PROFILE IMAGE PREVIEWS
========================================== */

function previewImage(inputId, previewId) {
    const input = getElement(inputId);
    const preview = getElement(previewId);

    if (!input || !preview) return;

    input.addEventListener("change", function () {
        const file = input.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please choose an image file.");

            input.value = "";

            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert("The image must be smaller than 5 MB.");

            input.value = "";

            return;
        }

        const imageURL = URL.createObjectURL(file);

        preview.src = imageURL;
        preview.style.display = "block";
    });
}


previewImage("profile-image", "profile-preview");

previewImage("edit-profile-image", "edit-profile-preview");


/* ==========================================
   24. PASSWORD RESET
========================================== */

async function resetPassword() {
    const emailInput =
        getElement("recovery-email") ||
        getElement("login-email") ||
        getElement("register-email");

    if (!emailInput) {
        alert("The email input for password recovery was not found.");
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        showMessage(
            "recovery-message",
            "Enter your email address first."
        );

        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);

        showMessage(
            "recovery-message",
            "Password reset email sent. Check your inbox.",
            true
        );

    } catch (error) {
        showMessage(
            "recovery-message",
            getErrorMessage(error)
        );
    }
}


window.resetPassword = resetPassword;


/* ==========================================
   25. REGISTRATION METHOD
========================================== */

const registerMethod = getElement("register-method");

function updateRegistrationMethod() {
    if (!registerMethod) return;

    const emailField = getElement("email-field");
    const phoneField = getElement("phone-field");

    const emailInput = getElement("register-email");
    const phoneInput = getElement("register-phone");

    const usingPhone = registerMethod.value === "phone";

    if (emailField) {
        emailField.style.display = usingPhone ? "none" : "block";
    }

    if (phoneField) {
        phoneField.style.display = usingPhone ? "block" : "none";
    }

    // This version creates accounts using Firebase email/password.
    // Selecting phone does not activate Firebase phone authentication.

    if (emailInput) {
        emailInput.required = !usingPhone;
    }

    if (phoneInput) {
        phoneInput.required = usingPhone;
    }
}


if (registerMethod) {
    registerMethod.addEventListener(
        "change",
        updateRegistrationMethod
    );

    updateRegistrationMethod();
}


/* ==========================================
   26. STOP REAL-TIME LISTENERS
========================================== */

function stopRealtimeListeners() {
    if (unsubscribeMessages) {
        unsubscribeMessages();
        unsubscribeMessages = null;
    }

    if (unsubscribeConversations) {
        unsubscribeConversations();
        unsubscribeConversations = null;
    }

    if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }
}


/* ==========================================
   27. CONNECT BUTTONS
========================================== */

function connectButton(id, callback) {
    const button = getElement(id);

    if (!button) {
        console.warn("Button not found in HTML:", id);
        return;
    }

    button.addEventListener("click", function (event) {
        // Do not interrupt normal form submission.
        if (button.type !== "submit") {
            event.preventDefault();
        }

        callback();
    });
}


/* Homepage buttons */

document.querySelectorAll(".login-btn").forEach(button => {
    button.addEventListener("click", function (event) {
        event.preventDefault();
        openLogin();
    });
});


document.querySelectorAll(".signup-btn").forEach(button => {
    button.addEventListener("click", function (event) {
        event.preventDefault();
        openRegister();
    });
});


document.querySelectorAll(".start-btn").forEach(button => {
    button.addEventListener("click", function (event) {
        event.preventDefault();
        openRegister();
    });
});


connectButton("home-logo", function () {
    if (currentUser) {
        openDashboard();
    } else {
        openLanding();
    }
});


/* Login and registration navigation */

connectButton("register-home-btn", openLanding);

connectButton("login-home-btn", openLanding);

connectButton("open-register-btn", openRegister);

/* Dashboard navigation */

connectButton("find-friends-btn", function () {
    showPage("find-friends-page");
});


connectButton("open-chat-btn", function () {
    showPage("chat-page");
    loadConversationList();
});


connectButton("open-friends-btn", function () {
    showPage("friends-page");

    loadFriendRequests();

    loadMyFriends();
});


connectButton("profile-btn", openProfile);


connectButton("open-notifications-btn", function () {
    showPage("notifications-page");
    loadNotifications();
});


connectButton("settings-btn", function () {
    showPage("settings-page");
});


/* Back buttons */

connectButton("back-dashboard-btn", openDashboard);

connectButton("friends-back-btn", openDashboard);

connectButton("chat-back-btn", openDashboard);

connectButton("profile-back-btn", openDashboard);

connectButton("notifications-back-btn", openDashboard);

connectButton("settings-back-btn", openDashboard);


/* Settings shortcuts */

connectButton("settings-profile-btn", openProfile);


connectButton("settings-notifications-btn", function () {
    showPage("notifications-page");
    loadNotifications();
});


/* Logout buttons */

connectButton("logout-btn", logoutUser);

connectButton("settings-logout-btn", logoutUser);


/* Friend profile actions */

connectButton("message-friend-btn", function () {
    if (!selectedFriendProfile) {
        alert("Select a user first.");
        return;
    }

    openConversation(selectedFriendProfile);
});


/* ==========================================
   28. AUTHENTICATION STATE
========================================== */

onAuthStateChanged(auth, async function (user) {
    currentUser = user;

    if (!user) {
        currentProfile = null;

        activeConversationId = null;
        activeChatUser = null;

        selectedFriendProfile = null;

        stopRealtimeListeners();

        openLanding();

        return;
    }

    try {
        await loadUserProfile(user);

        openDashboard();

    } catch (error) {
        console.error(
            "Could not load the signed-in user's profile:",
            error
        );

        alert(
            "You are signed in, but your profile could not be loaded. " +
            getErrorMessage(error)
        );
    }
});


/* ==========================================
   29. START NOVACHAT
========================================== */

console.log("NovaChat JavaScript loaded successfully.");