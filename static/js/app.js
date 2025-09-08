// Read user data from the JSON element
const userDataElement = document.getElementById('user-data');
const userData = userDataElement ? JSON.parse(userDataElement.textContent) : {};
const current_user_id = userData.current_user_id || null;

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Socket.IO
    const socket = io();
    
    // DOM elements
    const chatItems = document.querySelectorAll('.chat-item');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-btn');
    const attachButton = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const voiceMessageBtn = document.getElementById('voice-message-btn');
    const voiceRecorder = document.getElementById('voice-recorder');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const activeChat = document.querySelector('.active-chat');
    const chatPlaceholder = document.querySelector('.chat-placeholder');
    
    // Current chat state
    let currentChat = {
        id: null,
        type: null, // 'user' or 'group'
        partner: null
    };
    
    // Media recorder for voice messages
    let mediaRecorder;
    let audioChunks = [];
    let currentReplyMessageId = null;
    
    // Event listeners for chat items
    chatItems.forEach(item => {
        item.addEventListener('click', function() {
            const chatId = this.dataset.id;
            const chatType = this.dataset.type;
            
            // Update active chat
            chatItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            // Show chat area, hide placeholder
            activeChat.style.display = 'flex';
            chatPlaceholder.style.display = 'none';
            
            // Update current chat
            currentChat.id = chatId;
            currentChat.type = chatType;
            
            // Load messages
            loadMessages();
            
            // Join room if it's a group
            if (chatType === 'group') {
                socket.emit('join_group', { group_id: chatId });
            }
            
            // Update chat header
            updateChatHeader(this);
        });
    });
    
    // Send message function
    function sendMessage() {
        const content = messageInput.value.trim();
        if (!content || !currentChat.id) return;
        
        const messageData = {
            content: content,
            message_type: 'text'
        };
        
        if (currentChat.type === 'user') {
            messageData.receiver_id = currentChat.id;
        } else {
            messageData.group_id = currentChat.id;
        }
        
        // Add reply if there's a current reply message
        const replyIndicator = document.querySelector('.reply-indicator');
        if (replyIndicator && currentReplyMessageId) {
            messageData.reply_to_id = currentReplyMessageId;
            replyIndicator.remove();
            currentReplyMessageId = null;
        }
        
        socket.emit('send_message', messageData);
        messageInput.value = '';
    }
    
    // Send button click
    sendButton.addEventListener('click', sendMessage);
    
    // Enter key to send message
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // File attachment
    attachButton.addEventListener('click', function() {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', function() {
        if (!this.files.length || !currentChat.id) return;
        
        const file = this.files[0];
        const formData = new FormData();
        formData.append('file', file);
        
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const messageData = {
                    content: file.name,
                    message_type: getMessageType(file.type),
                    file_path: data.file_path
                };
                
                if (currentChat.type === 'user') {
                    messageData.receiver_id = currentChat.id;
                } else {
                    messageData.group_id = currentChat.id;
                }
                
                socket.emit('send_message', messageData);
            }
        })
        .catch(error => {
            console.error('Upload error:', error);
        });
        
        // Reset file input
        this.value = '';
    });
    
    // Voice message recording
    voiceMessageBtn.addEventListener('mousedown', startRecording);
    voiceMessageBtn.addEventListener('touchstart', startRecording);
    
    stopRecordingBtn.addEventListener('click', stopRecording);
    
    function startRecording(e) {
        e.preventDefault();
        if (!currentChat.id) return;
        
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];
                    
                    mediaRecorder.ondataavailable = event => {
                        audioChunks.push(event.data);
                    };
                    
                    mediaRecorder.onstop = () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        const formData = new FormData();
                        formData.append('file', audioBlob, 'voice-message.webm');
                        
                        fetch('/upload', {
                            method: 'POST',
                            body: formData
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                const messageData = {
                                    content: 'Voice message',
                                    message_type: 'audio',
                                    file_path: data.file_path
                                };
                                
                                if (currentChat.type === 'user') {
                                    messageData.receiver_id = currentChat.id;
                                } else {
                                    messageData.group_id = currentChat.id;
                                }
                                
                                socket.emit('send_message', messageData);
                            }
                        });
                        
                        // Stop all tracks
                        stream.getTracks().forEach(track => track.stop());
                    };
                    
                    mediaRecorder.start();
                    voiceRecorder.style.display = 'block';
                })
                .catch(error => {
                    console.error('Error accessing microphone:', error);
                });
        }
    }
    
    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            voiceRecorder.style.display = 'none';
        }
    }
    
    // Socket event handlers
    socket.on('receive_message', function(data) {
        // Only add message if it belongs to the current chat
        if (
            (currentChat.type === 'user' && 
             (data.sender_id == currentChat.id || data.receiver_id == currentChat.id)) ||
            (currentChat.type === 'group' && data.group_id == currentChat.id)
        ) {
            addMessageToChat(data);
        }
    });
    
    socket.on('user_typing', function(data) {
        // Show typing indicator
        showTypingIndicator(data);
    });
    
    socket.on('user_status', function(data) {
        // Update user online status
        updateUserStatus(data);
    });
    
    socket.on('reaction_update', function(data) {
        // Update message reactions
        updateMessageReaction(data);
    });
    
    // Load messages for current chat
    function loadMessages() {
        let url;
        if (currentChat.type === 'user') {
            url = `/messages/${currentChat.id}`;
        } else {
            url = `/group_messages/${currentChat.id}`;
        }
        
        fetch(url)
            .then(response => response.json())
            .then(messages => {
                messagesContainer.innerHTML = '';
                messages.forEach(message => {
                    addMessageToChat(message);
                });
                scrollToBottom();
            });
    }
    
    // Add message to chat UI
    function addMessageToChat(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.dataset.messageId = message.id;
        
        // Check if message is from current user
        const isSent = message.sender_id == current_user_id;
        messageEl.classList.add(isSent ? 'sent' : 'received');
        
        let messageContent = message.content;
        
        // Add reply indicator if this is a reply
        if (message.reply_to) {
            messageContent = `
                <div class="reply-indicator">
                    <div class="reply-sender">Replying to ${message.reply_to.sender_name}</div>
                    <div class="reply-content">${message.reply_to.content}</div>
                </div>
                ${messageContent}
            `;
        }
        
        // Handle different message types
        if (message.message_type !== 'text') {
            if (message.message_type === 'image') {
                messageContent = `<div class="media-message">
                    <img src="${message.file_path}" alt="Image">
                    <p>${message.content}</p>
                </div>`;
            } else if (message.message_type === 'audio') {
                messageContent = `<div class="media-message">
                    <audio controls>
                        <source src="${message.file_path}" type="audio/webm">
                        Your browser does not support the audio element.
                    </audio>
                    <p>${message.content}</p>
                </div>`;
            } else if (message.message_type === 'document') {
                messageContent = `<div class="media-message">
                    <a href="${message.file_path}" class="file-download" download>
                        📄 ${message.content}
                    </a>
                </div>`;
            }
        }
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageEl.innerHTML = `
            <div class="message-content">${messageContent}</div>
            <div class="message-time">${timestamp}</div>
        `;
        
        // Add reactions if any
        if (message.reactions && message.reactions.length > 0) {
            const reactionsContainer = document.createElement('div');
            reactionsContainer.className = 'message-reactions';
            
            // Group reactions by emoji
            const reactionCounts = {};
            message.reactions.forEach(reaction => {
                if (!reactionCounts[reaction.emoji]) {
                    reactionCounts[reaction.emoji] = {
                        count: 0,
                        users: []
                    };
                }
                reactionCounts[reaction.emoji].count++;
                reactionCounts[reaction.emoji].users.push(reaction.user_name);
            });
            
            // Create reaction elements
            for (const [emoji, data] of Object.entries(reactionCounts)) {
                const reactionEl = document.createElement('span');
                reactionEl.className = 'reaction';
                reactionEl.innerHTML = `
                    <span class="reaction-emoji">${emoji}</span>
                    <span class="reaction-count">${data.count}</span>
                `;
                reactionEl.title = data.users.join(', ');
                reactionsContainer.appendChild(reactionEl);
            }
            
            messageEl.appendChild(reactionsContainer);
        }
        
        // Add context menu for messages
        messageEl.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showMessageContextMenu(e, message);
        });
        
        // Add touch event for mobile
        let touchTimeout;
        messageEl.addEventListener('touchstart', function() {
            touchTimeout = setTimeout(() => {
                showMessageContextMenu({pageX: 50, pageY: 50}, message);
            }, 500);
        });
        
        messageEl.addEventListener('touchend', function() {
            clearTimeout(touchTimeout);
        });
        
        messagesContainer.appendChild(messageEl);
        scrollToBottom();
    }
    
    // Scroll to bottom of messages
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Update chat header with partner info
    function updateChatHeader(chatItem) {
        const partnerName = chatItem.querySelector('.chat-name').textContent;
        const partnerPic = chatItem.querySelector('.profile-pic').src;
        
        document.getElementById('chat-partner-name').textContent = partnerName;
        document.getElementById('chat-partner-pic').src = partnerPic;
        
        // For now, set a default status
        document.getElementById('chat-partner-status').textContent = 'Online';
    }
    
    // Show typing indicator
    function showTypingIndicator(data) {
        // Remove existing indicator
        const existingIndicator = document.querySelector('.typing-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        if (data.is_typing) {
            const indicator = document.createElement('div');
            indicator.classList.add('typing-indicator');
            indicator.innerHTML = `
                <span>${data.user_name || 'Someone'} is typing</span>
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            `;
            
            messagesContainer.appendChild(indicator);
            scrollToBottom();
            
            // Remove indicator after 3 seconds
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.remove();
                }
            }, 3000);
        }
    }
    
    // Update user status
    function updateUserStatus(data) {
        // This would update the status indicator in the chat list
        // For simplicity, we're just logging it
        console.log(`User ${data.user_id} is ${data.online ? 'online' : 'offline'}`);
    }
    
    // Update message reaction
    function updateMessageReaction(data) {
        const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (!messageEl) return;
        
        // This is a simplified implementation
        // In a real app, you'd want to properly update the reaction counts
        console.log('Reaction update:', data);
    }
    
    // Helper function to get message type from file type
    function getMessageType(fileType) {
        if (fileType.startsWith('image/')) {
            return 'image';
        } else if (fileType.startsWith('audio/')) {
            return 'audio';
        } else {
            return 'document';
        }
    }
    
    // Typing indicator
    let typingTimer;
    messageInput.addEventListener('input', function() {
        if (!currentChat.id) return;
        
        // Emit typing start
        const data = {
            is_typing: true
        };
        
        if (currentChat.type === 'user') {
            data.receiver_id = currentChat.id;
        } else {
            data.group_id = currentChat.id;
        }
        
        socket.emit('typing', data);
        
        // Clear previous timer
        clearTimeout(typingTimer);
        
        // Set timer to stop typing indicator after 1 second of inactivity
        typingTimer = setTimeout(() => {
            data.is_typing = false;
            socket.emit('typing', data);
        }, 1000);
    });
    
    // Show context menu for messages
    function showMessageContextMenu(e, message) {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const isOwnMessage = message.sender_id == current_user_id;
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        
        // Reply option
        const replyOption = document.createElement('div');
        replyOption.className = 'context-menu-item';
        replyOption.innerHTML = '↩️ Reply';
        replyOption.addEventListener('click', function() {
            replyToMessage(message);
            menu.remove();
        });
        menu.appendChild(replyOption);
        
        // React option
        const reactOption = document.createElement('div');
        reactOption.className = 'context-menu-item';
        reactOption.innerHTML = '😊 React';
        reactOption.addEventListener('click', function() {
            showReactionPicker(e, message);
            menu.remove();
        });
        menu.appendChild(reactOption);
        
        // Delete option (only for own messages)
        if (isOwnMessage) {
            const deleteOption = document.createElement('div');
            deleteOption.className = 'context-menu-item';
            deleteOption.innerHTML = '🗑️ Delete';
            deleteOption.addEventListener('click', function() {
                deleteMessage(message.id);
                menu.remove();
            });
            menu.appendChild(deleteOption);
        }
        
        document.body.appendChild(menu);
        
        // Close menu when clicking elsewhere
        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }
    
    // Show reaction picker
    function showReactionPicker(e, message) {
        const reactions = ['👍', '❤️', '😂', '😮', '😢', '😡'];
        const picker = document.createElement('div');
        picker.className = 'context-menu';
        picker.style.left = e.pageX + 'px';
        picker.style.top = (e.pageY - 40) + 'px';
        
        reactions.forEach(emoji => {
            const option = document.createElement('div');
            option.className = 'context-menu-item';
            option.textContent = emoji;
            option.addEventListener('click', function() {
                reactToMessage(message.id, emoji);
                picker.remove();
            });
            picker.appendChild(option);
        });
        
        document.body.appendChild(picker);
        
        // Close picker when clicking elsewhere
        const closePicker = function() {
            picker.remove();
            document.removeEventListener('click', closePicker);
        };
        
        setTimeout(() => {
            document.addEventListener('click', closePicker);
        }, 100);
    }
    
    // React to a message
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
            // The socket event will update the UI
        });
    }
    
    // Reply to a message
    function replyToMessage(message) {
        messageInput.value = '';
        messageInput.focus();
        
        // Create a reply indicator
        const replyIndicator = document.createElement('div');
        replyIndicator.className = 'reply-indicator';
        replyIndicator.innerHTML = `
            <div class="reply-sender">Replying to ${message.sender_name}</div>
            <div class="reply-content">${message.content}</div>
            <button class="cancel-reply">×</button>
        `;
        
        // Remove any existing reply indicator
        const existingIndicator = document.querySelector('.reply-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        messageInput.parentNode.insertBefore(replyIndicator, messageInput);
        
        // Cancel reply
        replyIndicator.querySelector('.cancel-reply').addEventListener('click', function() {
            replyIndicator.remove();
            currentReplyMessageId = null;
        });
        
        // Store the message being replied to
        currentReplyMessageId = message.id;
    }
    
    // Delete a message
    function deleteMessage(messageId) {
        // This would be implemented with a proper API endpoint
        console.log('Delete message:', messageId);
    }
});

// Request notification permission
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        const notificationPermission = document.createElement('div');
        notificationPermission.className = 'notification-permission';
        notificationPermission.innerHTML = `
            <p>Enable notifications to get alerts for new messages</p>
            <button id="enable-notifications">Enable</button>
        `;
        document.body.appendChild(notificationPermission);
        notificationPermission.style.display = 'block';
        
        document.getElementById('enable-notifications').addEventListener('click', function() {
            Notification.requestPermission().then(function(permission) {
                notificationPermission.style.display = 'none';
                if (permission === 'granted') {
                    registerPushNotifications();
                }
            });
        });
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            notificationPermission.style.display = 'none';
        }, 10000);
    }
}

// Register for push notifications
function registerPushNotifications() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(function(registration) {
            registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('ivyTN3460JvPh_DZvkiNpYr2i5M4E7FZBCI_i7TWLBkZ9NkqGoN1qWlEr-54rGDOJTNrPGO_hWVjvTR_iVF9mQ')
            }).then(function(subscription) {
                // Send subscription to server
                fetch('/push_subscription', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(subscription)
                });
            }).catch(function(error) {
                console.error('Failed to subscribe to push notifications:', error);
            });
        });
    }
}

// Utility function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Call this when the user logs in
requestNotificationPermission();