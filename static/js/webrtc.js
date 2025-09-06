// WebRTC functionality for video calls
class VideoCallManager {
    constructor() {
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isCaller = false;
        this.callActive = false;
        this.socket = io();
        
        this.setupSocketListeners();
        this.setupUIListeners();
    }
    
    setupSocketListeners() {
        // Listen for incoming call requests
        this.socket.on('call_request', (data) => {
            this.showIncomingCall(data);
        });
        
        // Listen for call acceptance
        this.socket.on('call_accepted', (data) => {
            this.isCaller = true;
            this.startCall(data);
        });
        
        // Listen for call rejection
        this.socket.on('call_rejected', () => {
            this.hideCallUI();
            alert('Call was rejected');
        });
        
        // Listen for call end
        this.socket.on('call_ended', () => {
            this.endCall();
        });
        
        // WebRTC signaling
        this.socket.on('offer', async (data) => {
            if (!this.callActive) return;
            
            await this.peerConnection.setRemoteDescription(data.offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                to: data.from,
                answer: answer
            });
        });
        
        this.socket.on('answer', async (data) => {
            await this.peerConnection.setRemoteDescription(data.answer);
        });
        
        this.socket.on('ice_candidate', async (data) => {
            try {
                await this.peerConnection.addIceCandidate(data.candidate);
            } catch (e) {
                console.error('Error adding ice candidate:', e);
            }
        });
    }
    
    setupUIListeners() {
        // Video call button
        document.getElementById('video-call-btn').addEventListener('click', () => {
            this.initiateCall();
        });
        
        // Call controls
        document.getElementById('end-call-btn').addEventListener('click', () => {
            this.endCall();
        });
        
        document.getElementById('mute-audio-btn').addEventListener('click', (e) => {
            this.toggleAudio(e.target);
        });
        
        document.getElementById('mute-video-btn').addEventListener('click', (e) => {
            this.toggleVideo(e.target);
        });
    }
    
    async initiateCall() {
        if (!currentChat.id || currentChat.type !== 'user') {
            alert('Please select a contact to call');
            return;
        }
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            
            this.showCallUI();
            this.setupPeerConnection();
            
            // Send call request
            this.socket.emit('call_request', {
                to: currentChat.id,
                from: current_user_id
            });
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            alert('Could not access camera or microphone');
        }
    }
    
    async startCall(data) {
        this.callActive = true;
        
        try {
            if (!this.localStream) {
                this.localStream = await navigator.mediaDevices.getUserMedia({ 
                    video: true, 
                    audio: true 
                });
            }
            
            this.showCallUI();
            this.setupPeerConnection();
            
            if (this.isCaller) {
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                this.socket.emit('offer', {
                    offer: offer,
                    to: data.from
                });
            }
            
        } catch (error) {
            console.error('Error starting call:', error);
            this.endCall();
        }
    }
    
    async setupPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        
        // Add local stream to connection
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });
        
        // Get remote stream
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            document.getElementById('remote-video').srcObject = this.remoteStream;
        };
        
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice_candidate', {
                    candidate: event.candidate,
                    to: currentChat.id
                });
            }
        };
        
        // Show local video
        document.getElementById('local-video').srcObject = this.localStream;
    }
    
    showCallUI() {
        document.getElementById('video-call-container').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    
    hideCallUI() {
        document.getElementById('video-call-container').style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    
    showIncomingCall(data) {
        if (confirm(`${data.from_name} is calling. Accept?`)) {
            this.socket.emit('call_accepted', {
                to: data.from,
                from: current_user_id
            });
            this.startCall(data);
        } else {
            this.socket.emit('call_rejected', {
                to: data.from
            });
        }
    }
    
    async endCall() {
        this.callActive = false;
        
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Stop media streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Notify other user
        if (currentChat.id) {
            this.socket.emit('call_ended', {
                to: currentChat.id
            });
        }
        
        this.hideCallUI();
    }
    
    toggleAudio(button) {
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                const enabled = !audioTracks[0].enabled;
                audioTracks[0].enabled = enabled;
                button.classList.toggle('muted', !enabled);
            }
        }
    }
    
    toggleVideo(button) {
        if (this.localStream) {
            const videoTracks = this.localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                const enabled = !videoTracks[0].enabled;
                videoTracks[0].enabled = enabled;
                button.classList.toggle('muted', !enabled);
                
                // Show/hide local video
                document.getElementById('local-video').style.display = enabled ? 'block' : 'none';
            }
        }
    }
}

// Initialize video call manager when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.videoCallManager = new VideoCallManager();
});