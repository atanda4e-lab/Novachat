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


/* =====================================
   1. GLOBAL VARIABLES
===================================== */

let currentUser = null;
let currentProfile = null;

let activeConversationId = null;
let activeChatUser = null;

let unsubscribeMessages = null;
let unsubscribeConversations = null;
let unsubscribeNotifications = null;

let selectedFriendProfile = null;


/* =====================================
   2. HELPER FUNCTIONS
===================================== */

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
    return username
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

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString();
}

function getErrorMessage(error) {
    console.error(error);

    const messages = {
        "auth/email-already-in-use":
            "This email is already registered.",

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

        "permission-denied":
            "Firebase denied this action. Check your Firestore rules.",

        "storage/unauthorized":
            "Image upload was denied. Check your Firebase Storage rules."
    };

    return messages[error.code] ||
        error.message ||
        "Something went wrong. Please try again.";
}


/* =====================================
   3. PAGE NAVIGATION
===================================== */

function showPage(pageId) {
    const target = getElement(pageId);

    if (!target) {
        console.error("Page not found:", pageId);
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

    const isLanding = pageId === "landing-page";

    if (navbar) {
        navbar.style.display = isLanding ? "flex" : "none";
    }

    if (footer) {
        footer.style.display = isLanding ? "block" : "none";
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

function openDashboard() {
    if (!currentUser) {
        openLogin();
        return;
    }

    showPage("dashboard");
    loadDashboard();
}

function openForgotPassword() {
    showPage("forgot-password-section");
}


/* =====================================
   4. PROFILE PHOTO UPLOAD
===================================== */

async function uploadProfilePhoto(file, userId) {
    if (!file) return "";

    if (!file.type.startsWith("image/")) {
        throw new Error("Please select an image file.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Your image must be smaller than 5 MB.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

    const imageRef = ref(
        storage,
        `profilePhotos/${userId}/${Date.now()}_${safeName}`
    );

    await uploadBytes(imageRef, file);

    return await getDownloadURL(imageRef);
}


/* =====================================
   5. REGISTRATION
===================================== */

const registerForm = getElement("register-form");

if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const fullName = getElement("full-name").value.trim();

        const username = normaliseUsername(
            getElement("username").value
        );

        const email = getElement("register-email").value.trim();

        const password = getElement("register-password").value;

        const confirmPassword =
            getElement("confirm-password").value;

        const imageFile = getElement("profile-image").files[0];

        if (username.length < 3) {
            showMessage(
                "register-message",
                "Username must contain at least 3 characters."
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

        showMessage("register-message", "Creating your account...", true);

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

            const userCredential =
                await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password
                );

            const user = userCredential.user;

            let photoURL = "";

            if (imageFile) {
                try {
                    photoURL = await uploadProfilePhoto(
                        imageFile,
                        user.uid
                    );
                } catch (uploadError) {
                    console.error("Photo upload failed:", uploadError);

                    showMessage(
                        "register-message",
                        "Account creation stopped while uploading your photo. Check Storage settings."
                    );

                    return;
                }
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

            await setDoc(doc(db, "users", user.uid), profile);

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
        }
    });
}


/* =====================================
   6. LOGIN
===================================== */

const loginForm = getElement("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const email = getElement("login-email").value.trim();

        const password = getElement("login-password").value;

        const loginButton = loginForm.querySelector(
            'button[type="submit"]'
        );

        if (loginButton) {
            loginButton.disabled = true;
            loginButton.textContent = "Logging in...";
        }

        showMessage("login-message", "Checking your account...", true);

        try {
            const result = await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

            currentUser = result.user;

            await loadUserProfile(result.user);

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
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = "Login";
            }
        }
    });
}


/* =====================================
   7. LOAD USER PROFILE
===================================== */

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


/* =====================================
   8. DASHBOARD
===================================== */

async function loadDashboard() {
    if (!currentUser) return;

    try {
        if (!currentProfile) {
            await loadUserProfile(currentUser);
        }

        if (!currentProfile) return;

        getElement("welcome-name").textContent =
            currentProfile.fullName || "User";

        getElement("dashboard-username").textContent =
            currentProfile.username
                ? "@" + currentProfile.username
                : "Choose a username in your profile";

        getElement("dashboard-email").textContent =
            currentProfile.email || currentUser.email || "";

        getElement("dashboard-photo").src =
            getPhoto(currentProfile);

        loadNotifications();
        loadConversationList();

    } catch (error) {
        console.error("Dashboard loading error:", error);
    }
}


/* =====================================
   9. LOGOUT
===================================== */

async function logoutUser() {
    try {
        stopRealtimeListeners();

        await signOut(auth);

        currentUser = null;
        currentProfile = null;

        activeConversationId = null;
        activeChatUser = null;

        openLanding();

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


/* =====================================
   10. FRIEND SEARCH
===================================== */

const friendsSearchForm = getElement("friends-search-form");

if (friendsSearchForm) {
    friendsSearchForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            openLogin();
            return;
        }

        const searchInput = getElement("friends-search-input");

        const searchTerm = normaliseUsername(searchInput.value);

        const resultsContainer = getElement("friends-list");

        resultsContainer.innerHTML = "";

        showMessage(
            "friends-search-message",
            "Searching for users...",
            true
        );

        try {
            const usernameSnapshot = await getDoc(
                doc(db, "usernames", searchTerm)
            );

            let foundProfiles = [];

            if (usernameSnapshot.exists()) {
                const usernameData = usernameSnapshot.data();

                const userId = usernameData.uid;

                if (userId && userId !== currentUser.uid) {
                    const profileSnapshot = await getDoc(
                        doc(db, "publicProfiles", userId)
                    );

                    if (profileSnapshot.exists()) {
                        foundProfiles.push(profileSnapshot.data());
                    }
                }
            }

            if (foundProfiles.length === 0) {
                const profilesQuery = query(
                    collection(db, "publicProfiles"),
                    where("username", "==", searchTerm)
                );

                const profileResults = await getDocs(profilesQuery);

                profileResults.forEach(profileDoc => {
                    const profile = profileDoc.data();

                    if (profile.uid !== currentUser.uid) {
                        foundProfiles.push(profile);
                    }
                });
            }

            resultsContainer.innerHTML = "";

            if (foundProfiles.length === 0) {
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

            foundProfiles.forEach(profile => {
                displaySearchResult(profile);
            });

            showMessage(
                "friends-search-message",
                `${foundProfiles.length} user found.`,
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
    const resultsContainer = getElement("friends-list");

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

    const viewButton = document.createElement("button");

    viewButton.type = "button";
    viewButton.textContent = "View Profile";

    viewButton.addEventListener("click", function () {
        openFriendProfile(profile);
    });

    details.appendChild(name);
    details.appendChild(username);
    details.appendChild(viewButton);

    card.appendChild(photo);
    card.appendChild(details);

    resultsContainer.appendChild(card);
}


/* =====================================
   11. FRIEND PROFILE POPUP
===================================== */

function openFriendProfile(profile) {
    if (!profile) return;

    selectedFriendProfile = profile;

    getElement("friend-profile-photo").src =
        getPhoto(profile);

    getElement("friend-profile-name").textContent =
        profile.fullName || "NovaChat User";

    getElement("friend-profile-username").textContent =
        profile.username ? "@" + profile.username : "";

    getElement("friend-profile-bio").textContent =
        profile.bio || "NovaChat community member.";

    const popup = getElement("friend-profile");

    popup.style.display = "block";
    popup.classList.add("active");

    const requestButton = getElement("send-friend-request-btn");

    if (requestButton) {
        requestButton.textContent = "Add Friend";
        requestButton.disabled = false;
    }
}

window.openFriendProfile = openFriendProfile;


const closeFriendProfileButton = getElement("close-friend-profile");

if (closeFriendProfileButton) {
    closeFriendProfileButton.addEventListener("click", function () {
        const popup = getElement("friend-profile");

        popup.style.display = "none";
        popup.classList.remove("active");

        selectedFriendProfile = null;
    });
}


/* =====================================
   12. SEND FRIEND REQUEST
===================================== */

const sendFriendRequestButton =
    getElement("send-friend-request-btn");

if (sendFriendRequestButton) {
    sendFriendRequestButton.addEventListener("click", async function () {
        if (!currentUser || !selectedFriendProfile) return;

        const friend = selectedFriendProfile;

        if (friend.uid === currentUser.uid) {
            alert("You cannot add yourself as a friend.");
            return;
        }

        sendFriendRequestButton.disabled = true;
        sendFriendRequestButton.textContent = "Sending...";

        try {
            const friendshipId = [
                currentUser.uid,
                friend.uid
            ].sort().join("_");

            const friendshipRef = doc(
                db,
                "friendships",
                friendshipId
            );

            const friendshipSnapshot = await getDoc(friendshipRef);

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
                alert("You have already sent a friend request.");
                return;
            }

            await addDoc(collection(db, "friendRequests"), {
                fromUid: currentUser.uid,
                toUid: friend.uid,
                fromName: currentProfile.fullName || "",
                toName: friend.fullName || "",
                status: "pending",
                createdAt: serverTimestamp()
            });

            await addDoc(collection(db, "notifications"), {
                userId: friend.uid,
                type: "friend_request",
                message:
                    `${currentProfile.fullName || "Someone"} sent you a friend request.`,
                read: false,
                createdAt: serverTimestamp()
            });

            alert("Friend request sent successfully!");

            sendFriendRequestButton.textContent = "Request Sent";

        } catch (error) {
            alert(getErrorMessage(error));

            sendFriendRequestButton.disabled = false;
            sendFriendRequestButton.textContent = "Add Friend";

        } finally {
            if (sendFriendRequestButton.textContent !== "Request Sent") {
                sendFriendRequestButton.disabled = false;
            }
        }
    });
}


/* =====================================
   13. FRIEND REQUESTS
===================================== */

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
                    fullName: request.fromName || "NovaChat User",
                    username: ""
                };

            const card = document.createElement("div");

            card.className = "friend-request-card";

            const title = document.createElement("h3");

            title.textContent = profile.fullName;

            const username = document.createElement("p");

            username.textContent = profile.username
                ? "@" + profile.username
                : "";

            const acceptButton = document.createElement("button");

            acceptButton.type = "button";
            acceptButton.textContent = "Accept";

            acceptButton.addEventListener("click", async () => {
                await respondToFriendRequest(
                    requestDoc.id,
                    request,
                    "accepted"
                );
            });

            const rejectButton = document.createElement("button");

            rejectButton.type = "button";
            rejectButton.textContent = "Reject";

            rejectButton.addEventListener("click", async () => {
                await respondToFriendRequest(
                    requestDoc.id,
                    request,
                    "rejected"
                );
            });

            card.append(title, username, acceptButton, rejectButton);

            container.appendChild(card);
        }

    } catch (error) {
        container.textContent = getErrorMessage(error);
    }
}


async function respondToFriendRequest(requestId, request, response) {
    try {
        await updateDoc(
            doc(db, "friendRequests", requestId),
            {
                status: response,
                respondedAt: serverTimestamp()
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
        }

        await loadFriendRequests();
        await loadMyFriends();

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


/* =====================================
   14. LOAD MY FRIENDS
===================================== */

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

            const friendUid = friendship.users.find(
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

            const name = document.createElement("h3");

            name.textContent = profile.fullName || "NovaChat User";

            const username = document.createElement("p");

            username.textContent = profile.username
                ? "@" + profile.username
                : "";

            const messageButton = document.createElement("button");

            messageButton.type = "button";
            messageButton.textContent = "Message";

            messageButton.addEventListener("click", () => {
                openConversation(profile);
            });

            card.append(name, username, messageButton);

            container.appendChild(card);
        }

    } catch (error) {
        container.textContent = getErrorMessage(error);
    }
}


/* =====================================
   15. CONVERSATION LIST
===================================== */

function loadConversationList() {
    if (!currentUser) return;

    const container = getElement("conversation-list");

    if (!container) return;

    if (unsubscribeConversations) {
        unsubscribeConversations();
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
                container.innerHTML =
                    '<p class="empty-message">No conversations yet. Find a friend to start chatting.</p>';
                return;
            }

            for (const conversationDoc of snapshot.docs) {
                const conversation = conversationDoc.data();

                const otherUid = conversation.participants.find(
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

                button.addEventListener("click", () => {
                    openConversation(profile, conversationDoc.id);
                });

                container.appendChild(button);
            }
        },
        error => {
            container.textContent = getErrorMessage(error);
        }
    );
}


/* =====================================
   16. OPEN CONVERSATION
===================================== */

async function openConversation(profile, existingConversationId = null) {
    if (!currentUser || !profile?.uid) return;

    if (profile.uid === currentUser.uid) {
        alert("You cannot start a conversation with yourself.");
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

        const conversationSnapshot = await getDoc(conversationRef);

        if (!conversationSnapshot.exists()) {
            await setDoc(conversationRef, {
                participants: [
                    currentUser.uid,
                    profile.uid
                ],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }

        activeConversationId = conversationId;
        activeChatUser = profile;

        getElement("chat-user-photo").src = getPhoto(profile);

        getElement("chat-user-name").textContent =
            profile.fullName || "NovaChat User";

        getElement("chat-user-username").textContent =
            profile.username ? "@" + profile.username : "";

        showPage("chat-page");

        listenForMessages(conversationId);

    } catch (error) {
        alert(getErrorMessage(error));
    }
}


/* =====================================
   17. LISTEN FOR MESSAGES
===================================== */

function listenForMessages(conversationId) {
    if (unsubscribeMessages) {
        unsubscribeMessages();
    }

    const messagesContainer = getElement("messages-container");

    messagesContainer.innerHTML = "<p>Loading messages...</p>";

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
            messagesContainer.innerHTML = "";

            if (snapshot.empty) {
                messagesContainer.innerHTML =
                    '<p class="empty-message">No messages yet. Say hello!</p>';
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

                messagesContainer.appendChild(bubble);
            });

            messagesContainer.scrollTop =
                messagesContainer.scrollHeight;
        },
        error => {
            messagesContainer.textContent = getErrorMessage(error);
        }
    );
}


/* =====================================
   18. SEND MESSAGE
===================================== */

const messageForm = getElement("message-form");

if (messageForm) {
    messageForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser || !activeConversationId) {
            showMessage(
                "chat-message-status",
                "Select a conversation first."
            );
            return;
        }

        const input = getElement("message-input");

        const messageText = input.value.trim();

        if (!messageText) return;

        const sendButton = getElement("send-message-btn");

        sendButton.disabled = true;

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
            sendButton.disabled = false;
        }
    });
}


/* =====================================
   19. NOTIFICATIONS
===================================== */

function loadNotifications() {
    if (!currentUser) return;

    if (unsubscribeNotifications) {
        unsubscribeNotifications();
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
            }

            if (!container) return;

            container.innerHTML = "";

            if (snapshot.empty) {
                container.innerHTML =
                    '<p class="empty-message">You do not have any notifications yet.</p>';
                return;
            }

            const notifications = [...snapshot.docs].sort((a, b) => {
                const timeA = a.data().createdAt?.seconds || 0;
                const timeB = b.data().createdAt?.seconds || 0;

                return timeB - timeA;
            });

            notifications.forEach(notificationDoc => {
                const notification = notificationDoc.data();

                const card = document.createElement("div");

                card.className = "notification-card";

                card.textContent = notification.message || "Notification";

                if (!notification.read) {
                    card.style.fontWeight = "bold";
                }

                container.appendChild(card);
            });
        },
        error => {
            console.error("Notification error:", error);
        }
    );
}


/* =====================================
   20. MARK NOTIFICATIONS AS READ
===================================== */

const markAllReadButton = getElement("mark-all-read-btn");

if (markAllReadButton) {
    markAllReadButton.addEventListener("click", async function () {
        if (!currentUser) return;

        try {
            const notificationsQuery = query(
                collection(db, "notifications"),
                where("userId", "==", currentUser.uid)
            );

            const snapshot = await getDocs(notificationsQuery);

            for (const notificationDoc of snapshot.docs) {
                if (!notificationDoc.data().read) {
                    await updateDoc(notificationDoc.ref, {
                        read: true
                    });
                }
            }

            alert("Notifications marked as read.");

        } catch (error) {
            alert(getErrorMessage(error));
        }
    });
}


/* =====================================
   21. EDIT PROFILE
===================================== */

function fillProfileForm() {
    if (!currentProfile) return;

    getElement("edit-full-name").value =
        currentProfile.fullName || "";

    getElement("edit-username").value =
        currentProfile.username || "";

    getElement("edit-bio").value =
        currentProfile.bio || "";

    getElement("edit-profile-preview").src =
        getPhoto(currentProfile);
}


const editProfileForm = getElement("edit-profile-form");

if (editProfileForm) {
    editProfileForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser || !currentProfile) return;

        const fullName =
            getElement("edit-full-name").value.trim();

        const username =
            normaliseUsername(getElement("edit-username").value);

        const bio =
            getElement("edit-bio").value.trim();

        const imageFile =
            getElement("edit-profile-image").files[0];

        if (username.length < 3) {
            showMessage(
                "profile-message",
                "Username must contain at least 3 characters."
            );
            return;
        }

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
                    showMessage(
                        "profile-message",
                        "That username is already taken."
                    );
                    return;
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
                fullName,
                username,
                bio,
                photoURL
            };

            await updateDoc(
                doc(db, "users", currentUser.uid),
                updatedProfile
            );

            await setDoc(
                doc(db, "publicProfiles", currentUser.uid),
                {
                    uid: currentUser.uid,
                    ...updatedProfile
                }
            );

            if (username !== oldUsername) {
                await setDoc(
                    doc(db, "usernames", username),
                    {
                        uid: currentUser.uid,
                        username
                    }
                );

                if (oldUsername) {
                    const oldUsernameRef = doc(
                        db,
                        "usernames",
                        oldUsername
                    );

                    const oldUsernameSnapshot =
                        await getDoc(oldUsernameRef);

                    if (
                        oldUsernameSnapshot.exists() &&
                        oldUsernameSnapshot.data().uid === currentUser.uid
                    ) {
                        await updateDoc(oldUsernameRef, {
                            uid: currentUser.uid,
                            username: oldUsername,
                            available: false
                        });
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
            loadDashboard();

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
        }
    });
}


/* =====================================
   22. IMAGE PREVIEWS
===================================== */

function previewImage(inputId, previewId) {
    const input = getElement(inputId);
    const preview = getElement(previewId);

    if (!input || !preview) return;

    input.addEventListener("change", function () {
        const file = input.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please choose an image file.");
            input.value = "";
            return;
        }

        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
    });
}

previewImage("profile-image", "profile-preview");

previewImage("edit-profile-image", "edit-profile-preview");


/* =====================================
   23. PASSWORD RESET
===================================== */

async function resetPassword() {
    const emailInput = getElement("recovery-email");

    if (!emailInput) {
        alert("The password recovery form is not present in your HTML.");
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


/* =====================================
   24. STOP REAL-TIME LISTENERS
===================================== */

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


/* =====================================
   25. NAVIGATION BUTTONS
===================================== */

function connectButton(id, action) {
    const button = getElement(id);

    if (button) {
        button.addEventListener("click", action);
    }
}


// Homepage navigation

document.querySelectorAll(".login-btn").forEach(button => {
    button.addEventListener("click", openLogin);
});

document.querySelectorAll(".signup-btn").forEach(button => {
    button.addEventListener("click", openRegister);
});

document.querySelectorAll(".start-btn").forEach(button => {
    button.addEventListener("click", openRegister);
});

connectButton("home-logo", openLanding);

document.querySelectorAll(".dashboard-header .logo").forEach(button => {
    button.addEventListener("click", event => {
        event.preventDefault();
        openDashboard();
    });
});


// Registration and login navigation

connectButton("register-home-btn", openLanding);
connectButton("login-home-btn", openLanding);
connectButton("open-register-btn", openRegister);

connectButton("forgot-password-btn", openForgotPassword);
connectButton("open-forgot-password-btn", openForgotPassword);
connectButton("back-to-login-btn", openLogin);


// Dashboard navigation

connectButton("find-friends-btn", () => {
    showPage("find-friends-page");
});

connectButton("open-chat-btn", () => {
    showPage("chat-page");
    loadConversationList();
});

connectButton("open-friends-btn", () => {
    showPage("friends-page");
    loadFriendRequests();
    loadMyFriends();
});

connectButton("profile-btn", () => {
    fillProfileForm();
    showPage("edit-profile-page");
});

connectButton("open-notifications-btn", () => {
    showPage("notifications-page");
});

connectButton("settings-btn", () => {
    showPage("settings-page");
});


// Back buttons

connectButton("back-dashboard-btn", openDashboard);
connectButton("friends-back-btn", openDashboard);
connectButton("chat-back-btn", openDashboard);
connectButton("profile-back-btn", openDashboard);
connectButton("notifications-back-btn", openDashboard);
connectButton("settings-back-btn", openDashboard);


// Settings shortcuts

connectButton("settings-profile-btn", () => {
    fillProfileForm();
    showPage("edit-profile-page");
});

connectButton("settings-notifications-btn", () => {
    showPage("notifications-page");
});


// Logout buttons

connectButton("logout-btn", logoutUser);
connectButton("settings-logout-btn", logoutUser);


/* =====================================
   26. REGISTRATION METHOD
===================================== */

const registerMethod = getElement("register-method");

function updateRegistrationMethod() {
    if (!registerMethod) return;

    const emailField = getElement("email-field");
    const phoneField = getElement("phone-field");

    const emailInput = getElement("register-email");
    const phoneInput = getElement("register-phone");

    const usingPhone = registerMethod.value === "phone";

    emailField.style.display = usingPhone ? "none" : "block";
    phoneField.style.display = usingPhone ? "block" : "none";

    emailInput.required = !usingPhone;
    phoneInput.required = usingPhone;
}

if (registerMethod) {
    registerMethod.addEventListener(
        "change",
        updateRegistrationMethod
    );

    updateRegistrationMethod();
}


/* =====================================
   27. AUTHENTICATION STATE
===================================== */

onAuthStateChanged(auth, async user => {
    currentUser = user;

    if (!user) {
        currentProfile = null;

        stopRealtimeListeners();

        activeConversationId = null;
        activeChatUser = null;

        openLanding();

        return;
    }

    try {
        await loadUserProfile(user);

        // Only navigate after Firebase confirms authentication
        // and the user profile has loaded successfully.
        openDashboard();

    } catch (error) {
        console.error("Authentication setup failed:", error);

        showPage("dashboard");

        alert(
            "You are logged in, but your profile could not be loaded. " +
            getErrorMessage(error)
        );
    }
});


/* =====================================
   28. START THE APP
===================================== */

console.log("NovaChat JavaScript loaded successfully.");
