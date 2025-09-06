// Socket.IO connection
const socket = io();

// Global variables
let currentChat = null;
let currentChatType = null; // 'user' or 'group'
let typingTimer = null;

// DOM Elements
const contactsList = document.getElementById('contacts-list');
const chatHeader = document.getElementById('chat-header');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const typingIndicator = document.getElementById('typing-indicator');
const fileInput = document.getElementById('file-input');
const emojiPicker = document.getElementById('emoji-picker');
const callButton = document.getElementById('call-button');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', handleTyping);
    messageInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    fileInput.addEventListener('change', handleFileUpload);
    
    // Socket event listeners
    socket.on('receive_message', handleReceivedMessage);
    socket.on('user_typing', handleUserTyping);
    socket.on('user_status', handleUserStatus);
    socket.on('message_reaction', handleMessageReaction);
    socket.on('reaction_update', handleReactionUpdate);
    
    // Call related events
    socket.on('call_request', handleCallRequest);
    socket.on('call_accepted', handleCallAccepted);
    socket.on('call_rejected', handleCallRejected);
    socket.on('call_ended', handleCallEnded);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice_candidate', handleIceCandidate);
});

// Contact selection
function selectContact(contactId, contactType, contactName) {
    // Update UI
    const contactItems = document.querySelectorAll('.contact-item');
    contactItems.forEach(item => item.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    // Update current chat
    currentChat = contactId;
    currentChatType = contactType;
    
    // Update chat header
    chatHeader.innerHTML = `
        <div class="d-flex align-items-center">
            <img src="${contactType === 'user' ? '/static/uploads/default.jpg' : ''}" 
                 class="${contactType === 'user' ? 'contact-avatar' : 'group-avatar'}" 
                 alt="${contactName}">
            <div>
                <h5 class="mb-0">${contactName}</h5>
                <small class="text-muted" id="user-status">Online</small>
            </div>
        </div>
        ${contactType === 'user' ? '<button id="call-button" class="call-btn"><i class="fas fa-phone"></i></button>' : ''}
    `;
    
    // Load messages
    loadMessages();
    
    // Add event listener for call button if it's a user chat
    if (contactType === 'user') {
        document.getElementById('call-button').addEventListener('click', initiateCall);
    }
}

// Load messages
function loadMessages() {
    let url;
    if (currentChatType === 'user') {
        url = `/messages/${currentChat}`;
    } else {
        url = `/group_messages/${currentChat}`;
    }
    
    fetch(url)
        .then(response => response.json())
        .then(messages => {
            chatMessages.innerHTML = '';
            messages.forEach(message => {
                displayMessage(message);
            });
            scrollToBottom();
        });
}

// Display message
function displayMessage(message) {
    const isSent = message.sender_id === currentUserId;
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', isSent ? 'sent' : 'received');
    
    let messageContent = '';
    
    // Reply indicator if exists
    if (message.reply_to) {
        messageContent += `
            <div class="reply-indicator">
                Replying to ${message.reply_to.sender_name}: ${message.reply_to.content}
            </div>
        `;
    }
    
    // Message content based on type
    if (message.message_type === 'text') {
        messageContent += `<div class="message-bubble">${message.content}</div>`;
    } else if (message.message_type === 'image') {
        messageContent += `
            <div class="message-bubble">
                <img src="${message.file_path}" style="max-width: 200px; border-radius: 8px;">
            </div>
        `;
    } else if (message.message_type === 'file') {
        const fileName = message.file_path.split('/').pop();
        messageContent += `
            <div class="message-bubble">
                <div class="file-message">
                    <span class="file-icon"><i class="fas fa-file"></i></span>
                    <a href="${message.file_path}" download>${fileName}</a>
                </div>
            </div>
        `;
    }
    
    // Message info and reactions
    messageContent += `
        <div class="message-info">
            <span>${new Date(message.timestamp).toLocaleTimeString()}</span>
            ${isSent ? `<span>${message.is_read ? 'Read' : 'Delivered'}</span>` : ''}
        </div>
        <div class="message-reactions" id="reactions-${message.id}">
            ${message.reactions ? renderReactions(message.reactions) : ''}
        </div>
    `;
    
    messageElement.innerHTML = messageContent;
    
    // Add event listeners for reactions
    const messageBubble = messageElement.querySelector('.message-bubble');
    messageBubble.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showReactionMenu(e, message.id);
    });
    
    chatMessages.appendChild(messageElement);
}

// Render reactions
function renderReactions(reactions) {
    const reactionCounts = {};
    reactions.forEach(reaction => {
        if (!reactionCounts[reaction.emoji]) {
            reactionCounts[reaction.emoji] = {
                count: 1,
                users: [reaction.user_name]
            };
        } else {
            reactionCounts[reaction.emoji].count++;
            reactionCounts[reaction.emoji].users.push(reaction.user_name);
        }
    });
    
    return Object.entries(reactionCounts).map(([emoji, data]) => `
        <span class="reaction" title="${data.users.join(', ')}">
            ${emoji} <span class="reaction-count">${data.count}</span>
        </span>
    `).join('');
}

// Show reaction menu
function showReactionMenu(event, messageId) {
    // Remove any existing reaction menu
    const existingMenu = document.getElementById('reaction-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Create reaction menu
    const reactionMenu = document.createElement('div');
    reactionMenu.id = 'reaction-menu';
    reactionMenu.style.position = 'absolute';
    reactionMenu.style.left = `${event.pageX}px`;
    reactionMenu.style.top = `${event.pageY}px`;
    reactionMenu.style.background = 'white';
    reactionMenu.style.borderRadius = '8px';
    reactionMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    reactionMenu.style.padding = '0.5rem';
    reactionMenu.style.zIndex = '1000';
    reactionMenu.style.display = 'flex';
    reactionMenu.style.gap = '0.5rem';
    
    const reactions = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    reactions.forEach(emoji => {
        const button = document.createElement('button');
        button.classList.add('reaction-btn');
        button.textContent = emoji;
        button.addEventListener('click', () => {
            reactToMessage(messageId, emoji);
            reactionMenu.remove();
        });
        reactionMenu.appendChild(button);
    });
    
    document.body.appendChild(reactionMenu);
    
    // Close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            reactionMenu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
}

// React to message
function reactToMessage(messageId, emoji) {
    fetch(`/message/${messageId}/react`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ emoji: emoji })
    })
    .then(response => response.json())
    .then(data => {
        // The socket event will handle the UI update
    });
}

// Handle received message
function handleReceivedMessage(data) {
    if ((currentChatType === 'user' && 
        ((data.sender_id === currentChat && data.receiver_id === currentUserId) || 
         (data.sender_id === currentUserId && data.receiver_id === currentChat))) ||
        (currentChatType === 'group' && data.group_id === currentChat)) {
        displayMessage(data);
        scrollToBottom();
    }
}

// Handle user typing
function handleUserTyping(data) {
    if ((currentChatType === 'user' && data.user_id === currentChat) ||
        (currentChatType === 'group' && data.user_id !== currentUserId)) {
        typingIndicator.textContent = `${data.user_name || 'Someone'} is typing...`;
        typingIndicator.style.display = 'block';
        
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            typingIndicator.style.display = 'none';
        }, 1000);
    }
}

// Handle user status
function handleUserStatus(data) {
    const statusElement = document.getElementById('user-status');
    if (statusElement && data.user_id === currentChat) {
        statusElement.textContent = data.online ? 'Online' : 'Offline';
    }
    
    // Update contact list status indicators
    const contactItem = document.querySelector(`.contact-item[data-user-id="${data.user_id}"]`);
    if (contactItem) {
        const statusIndicator = contactItem.querySelector('.online-status, .offline-status');
        if (statusIndicator) {
            statusIndicator.className = data.online ? 'online-status' : 'offline-status';
        }
    }
}

// Handle message reaction
function handleMessageReaction(data) {
    const reactionsContainer = document.getElementById(`reactions-${data.message_id}`);
    if (reactionsContainer) {
        // This would be handled by the reaction_update event instead
    }
}

// Handle reaction update
function handleReactionUpdate(data) {
    // This would update the UI when a reaction is added or removed
    // Implementation would depend on how you want to display reactions
}

// Send message
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content && !fileInput.files.length) return;
    
    const messageData = {
        content: content,
        message_type: 'text'
    };
    
    if (currentChatType === 'user') {
        messageData.receiver_id = currentChat;
    } else {
        messageData.group_id = currentChat;
    }
    
    socket.emit('send_message', messageData);
    messageInput.value = '';
}

// Handle typing
function handleTyping() {
    if (typingTimer) {
        clearTimeout(typingTimer);
    }
    
    socket.emit('typing', {
        is_typing: true,
        [currentChatType === 'user' ? 'receiver_id' : 'group_id']: currentChat
    });
    
    typingTimer = setTimeout(() => {
        socket.emit('typing', {
            is_typing: false,
            [currentChatType === 'user' ? 'receiver_id' : 'group_id']: currentChat
        });
    }, 1000);
}

// Handle file upload
function handleFileUpload() {
    if (!fileInput.files.length) return;
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const messageData = {
                content: 'File',
                message_type: fileInput.files[0].type.startsWith('image/') ? 'image' : 'file',
                file_path: data.file_path
            };
            
            if (currentChatType === 'user') {
                messageData.receiver_id = currentChat;
            } else {
                messageData.group_id = currentChat;
            }
            
            socket.emit('send_message', messageData);
            fileInput.value = '';
        }
    });
}

// Scroll to bottom
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Voice and Video Call Functions
let localStream = null;
let peerConnection = null;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initiate call
function initiateCall() {
    if (currentChatType !== 'user') return;
    
    // Show calling UI
    showCallUI('calling');
    
    // Send call request
    socket.emit('call_request', {
        to: currentChat,
        from: currentUserId
    });
    
    // Set up timeout for no answer
    setTimeout(() => {
        if (document.getElementById('call-container')) {
            endCall();
            alert('Call not answered');
        }
    }, 30000);
}

// Handle call request
function handleCallRequest(data) {
    // Show incoming call UI
    showCallUI('incoming', data.from_name);
}

// Handle call accepted
function handleCallAccepted(data) {
    // Update UI to show call in progress
    showCallUI('active');
    
    // Start setting up WebRTC
    setupWebRTC(true);
}

// Handle call rejected
function handleCallRejected() {
    endCall();
    alert('Call rejected');
}

// Handle call ended
function handleCallEnded() {
    endCall();
    alert('Call ended');
}

// Show call UI
function showCallUI(state, callerName = null) {
    // Remove any existing call UI
    const existingCallUI = document.getElementById('call-container');
    if (existingCallUI) {
        existingCallUI.remove();
    }
    
    let callUIHTML = '';
    
    if (state === 'incoming') {
        callUIHTML = `
            <div class="call-container">
                <h3 style="color: white;">Incoming call from ${callerName}</h3>
                <div class="call-buttons">
                    <button class="call-btn-accept" onclick="acceptCall()"><i class="fas fa-phone"></i></button>
                    <button class="call-btn-reject" onclick="rejectCall()"><i class="fas fa-phone-slash"></i></button>
                </div>
            </div>
        `;
    } else if (state === 'calling') {
        callUIHTML = `
            <div class="call-container">
                <h3 style="color: white;">Calling...</h3>
                <div class="call-buttons">
                    <button class="call-btn-reject" onclick="endCall()"><i class="fas fa-phone-slash"></i></button>
                </div>
            </div>
        `;
    } else if (state === 'active') {
        callUIHTML = `
            <div class="call-container">
                <div class="video-container">
                    <video id="remote-video" class="remote-video" autoplay></video>
                    <video id="local-video" class="local-video" autoplay muted></video>
                </div>
                <div class="call-buttons">
                    <button class="call-btn-end" onclick="endCall()"><i class="fas fa-phone-slash"></i></button>
                </div>
            </div>
        `;
    }
    
    document.body.insertAdjacentHTML('beforeend', callUIHTML);
}

// Accept call
function acceptCall() {
    socket.emit('call_accepted', {
        to: currentChat, // The caller
        from: currentUserId
    });
    
    // Start setting up WebRTC
    setupWebRTC(false);
}

// Reject call
function rejectCall() {
    socket.emit('call_rejected', {
        to: currentChat // The caller
    });
    
    endCall();
}

// End call
function endCall() {
    socket.emit('call_ended', {
        to: currentChat
    });
    
    // Close streams and connection
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    if (peerConnection) {
        peerConnection.close();
    }
    
    // Remove call UI
    const callUI = document.getElementById('call-container');
    if (callUI) {
        callUI.remove();
    }
}

// Setup WebRTC
async function setupWebRTC(isCaller) {
    try {
        // Get local media stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // Display local video
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(configuration);
        
        // Add local stream to connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
            }
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    to: currentChat,
                    candidate: event.candidate
                });
            }
        };
        
        // Create offer if caller
        if (isCaller) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('offer', {
                to: currentChat,
                offer: offer
            });
        }
    } catch (error) {
        console.error('Error setting up WebRTC:', error);
        endCall();
    }
}

// Handle offer
async function handleOffer(data) {
    if (!peerConnection) return;
    
    await peerConnection.setRemoteDescription(data.offer);
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        to: data.from,
        answer: answer
    });
}

// Handle answer
async function handleAnswer(data) {
    if (!peerConnection) return;
    
    await peerConnection.setRemoteDescription(data.answer);
}

// Handle ICE candidate
async function handleIceCandidate(data) {
    if (!peerConnection) return;
    
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

// Global functions for HTML onclick attributes
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.endCall = endCall;