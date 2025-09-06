import os
from flask import Flask, render_template, url_for, flash, redirect, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_login import LoginManager, login_user, current_user, logout_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime
import json
from pywebpush import webpush, WebPushException
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import base64
from PIL import Image
from flask_sqlalchemy import SQLAlchemy
from extensions import db
from forms import RegistrationForm, LoginForm, UpdateAccountForm, GroupForm
from models import User, Message, Group, GroupMember, MessageReaction
from flask_bcrypt import Bcrypt
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField, BooleanField, TextAreaField, FileField
from wtforms.validators import DataRequired, Length, Email, EqualTo, ValidationError
from models import User, Message
import os
from forms import UpdateGroupForm

# Create Flask app first
app = Flask(__name__)
app.config['SECRET_KEY'] = 'd29c234ca310aa6990092d4b6cd4c4854585c51e1f73bf4de510adca03f5bc4e'  # Change this in production!
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///app.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize extensions
 # Initialize db ith app
db.init_app(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins="*")
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message_category = 'info'

# Now import models AFTER db is initialized
from models import User, Message, Group, GroupMember, MessageReaction

# VAPID keys (replace with your own keys)
VAPID_PRIVATE_KEY = "RMjjSP6S-RN6U49FPbbDGWZ_dpxI5hlwZlKQHThgBxc"
VAPID_PUBLIC_KEY  = "ivyTN3460JvPh_DZvkiNpYr2i5M4E7FZBCI_i7TWLBkZ9NkqGoN1qWlEr-54rGDOJTNrPGO_hWVjvTR_iVF9mQ"
VAPID_CLAIMS = {
    "sub": "mailto:mpc0679@gmail.com"  # replace with your email
}

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# Routes
@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('chats'))
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('chats'))
    
    form = RegistrationForm()  # Create form instance
    
    if form.validate_on_submit():
        # Form validation passed, process the data
        hashed_password = bcrypt.generate_password_hash(form.password.data).decode('utf-8')
        user = User(username=form.username.data, email=form.email.data, password=hashed_password)
        db.session.add(user)
        db.session.commit()
        flash('Your account has been created! You can now log in.', 'success')
        return redirect(url_for('login'))
    
    # Pass the form to the template
    return render_template('auth.html', title='Register', form=form, form_type='register')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('chats'))
    
    form = LoginForm()
    
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and bcrypt.check_password_hash(user.password, form.password.data):
            login_user(user, remember=form.remember.data)
            next_page = request.args.get('next')
            return redirect(next_page) if next_page else redirect(url_for('chats'))
        else:
            flash('Login unsuccessful. Please check email and password', 'danger')
    
    return render_template('auth.html', title='Login', form=form, form_type='login')


@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('index'))

# Add this route to store push subscriptions
@app.route('/push_subscription', methods=['POST'])
@login_required
def push_subscription():
    subscription = request.json
    # Store subscription in database associated with current user
    current_user.push_subscription = json.dumps(subscription)
    db.session.commit()
    return jsonify({'status': 'success'})

# Function to send push notification
def send_push_notification(user, title, body, url=None):
    if not user.push_subscription:
        return False
    
    try:
        subscription = json.loads(user.push_subscription)
        webpush(
            subscription_info=subscription,
            data=json.dumps({
                'title': title,
                'body': body,
                'url': url or url_for('chats', _external=True)
            }),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
        return True
    except WebPushException as e:
        print("Web push failed:", e)
        if e.response.status_code == 410:
            # Subscription is no longer valid, remove it
            user.push_subscription = None
            db.session.commit()
        return False

@app.route('/chats')
@login_required
def chats():
    # Get all users for contacts list
    users = User.query.filter(User.id != current_user.id).all()
    
    # Get user's groups
    user_groups = Group.query.join(GroupMember).filter(GroupMember.user_id == current_user.id).all()
    
    return render_template('chat.html', users=users, groups=user_groups)

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    form = UpdateAccountForm(obj=current_user)  # pre-fill form with current user data

    if form.validate_on_submit():
        # Check if username changed and is unique
        if form.username.data != current_user.username:
            existing_user = User.query.filter_by(username=form.username.data).first()
            if existing_user:
                flash('Username already taken', 'danger')
                return redirect(url_for('profile'))

        # Handle profile picture
        if form.picture.data:
            picture_file = save_picture(form.picture.data)
            current_user.profile_picture = picture_file

        # Update user info
        current_user.username = form.username.data
        current_user.status = form.status.data
        db.session.commit()

        flash('Your account has been updated!', 'success')
        return redirect(url_for('profile'))

    return render_template('profile.html', form=form)


from forms import GroupForm

@app.route('/create_group', methods=['GET', 'POST'])
@login_required
def create_group():
    form = GroupForm()
    if form.validate_on_submit():
        group = Group(name=form.name.data, description=form.description.data, creator_id=current_user.id)
        db.session.add(group)
        db.session.commit()
        
        member = GroupMember(group_id=group.id, user_id=current_user.id, is_admin=True)
        db.session.add(member)
        db.session.commit()
        
        flash('Your group has been created!', 'success')
        return redirect(url_for('chats'))
    
    return render_template('create_group.html', form=form)




@app.route('/messages/<int:user_id>')
@login_required
def get_messages(user_id):
    messages = Message.query.filter(
        ((Message.sender_id == current_user.id) & (Message.receiver_id == user_id)) |
        ((Message.sender_id == user_id) & (Message.receiver_id == current_user.id))
    ).order_by(Message.timestamp.asc()).all()
    
    # Mark messages as read
    for message in messages:
        if message.receiver_id == current_user.id and not message.is_read:
            message.is_read = True
    db.session.commit()
    
    return jsonify([{
        'id': msg.id,
        'content': msg.content,
        'timestamp': msg.timestamp.isoformat(),
        'sender_id': msg.sender_id,
        'receiver_id': msg.receiver_id,
        'is_read': msg.is_read,
        'message_type': msg.message_type
    } for msg in messages])

@app.route('/group_messages/<int:group_id>')
@login_required
def get_group_messages(group_id):
    messages = Message.query.filter_by(group_id=group_id).order_by(Message.timestamp.asc()).all()
    
    return jsonify([{
        'id': msg.id,
        'content': msg.content,
        'timestamp': msg.timestamp.isoformat(),
        'sender_id': msg.sender_id,
        'group_id': msg.group_id,
        'is_read': msg.is_read,
        'message_type': msg.message_type,
        'sender_name': msg.sender.username
    } for msg in messages])

@app.route('/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'})
    
    if file:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        return jsonify({
            'success': True,
            'file_path': url_for('static', filename=f'uploads/{filename}')
        })
    
    return jsonify({'error': 'File upload failed'})

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# SocketIO events
@socketio.on('connect')
def handle_connect():
    if current_user.is_authenticated:
        join_room(str(current_user.id))
        current_user.last_seen = datetime.utcnow()
        db.session.commit()
        emit('user_status', {'user_id': current_user.id, 'online': True}, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    if current_user.is_authenticated:
        leave_room(str(current_user.id))
        current_user.last_seen = datetime.utcnow()
        db.session.commit()
        emit('user_status', {'user_id': current_user.id, 'online': False}, broadcast=True)

# Combined send_message handler
@socketio.on('send_message')
def handle_send_message(data):
    content = data['content']
    receiver_id = data.get('receiver_id')
    group_id = data.get('group_id')
    message_type = data.get('message_type', 'text')
    file_path = data.get('file_path')
    reply_to_id = data.get('reply_to_id')
    
    message = Message(
        content=content,
        sender_id=current_user.id,
        receiver_id=receiver_id,
        group_id=group_id,
        message_type=message_type,
        file_path=file_path,
        reply_to_id=reply_to_id
    )
    
    db.session.add(message)
    db.session.commit()
    
    # After saving the message, send notification to receiver for direct messages
    if not group_id and receiver_id:  # Only for direct messages
        receiver = User.query.get(receiver_id)
        if receiver and receiver.push_subscription:
            send_push_notification(
                receiver,
                f"New message from {current_user.username}",
                content[:100] + ('...' if len(content) > 100 else ''),
                url_for('chats', _external=True)
            )
    
    # Prepare response data
    response = {
        'id': message.id,
        'content': message.content,
        'timestamp': message.timestamp.isoformat(),
        'sender_id': message.sender_id,
        'receiver_id': message.receiver_id,
        'group_id': message.group_id,
        'is_read': message.is_read,
        'message_type': message.message_type,
        'file_path': message.file_path,
        'sender_name': current_user.username,
        'reply_to_id': message.reply_to_id
    }
    
    # If replying to a message, include replied message info
    if message.reply_to_id:
        replied_msg = Message.query.get(message.reply_to_id)
        if replied_msg:
            response['reply_to'] = {
                'id': replied_msg.id,
                'content': replied_msg.content[:50] + ('...' if len(replied_msg.content) > 50 else ''),
                'sender_name': replied_msg.sender.username
            }
    
    if group_id:
        # Send to all group members
        emit('receive_message', response, room=str(group_id))
    else:
        # Send to receiver
        emit('receive_message', response, room=str(receiver_id))
        # Also send to sender for UI update
        emit('receive_message', response, room=str(current_user.id))

@socketio.on('join_group')
def handle_join_group(data):
    group_id = data['group_id']
    join_room(str(group_id))

@socketio.on('typing')
def handle_typing(data):
    receiver_id = data.get('receiver_id')
    group_id = data.get('group_id')
    is_typing = data['is_typing']
    
    if group_id:
        emit('user_typing', {
            'user_id': current_user.id,
            'user_name': current_user.username,
            'is_typing': is_typing
        }, room=str(group_id), include_self=False)
    else:
        emit('user_typing', {
            'user_id': current_user.id,
            'is_typing': is_typing
        }, room=str(receiver_id))

# PWA routes
@app.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')

@app.route('/service-worker.js')
def service_worker():
    return send_from_directory('static', 'service-worker.js')

# Helper functions
def save_picture(form_picture):
    random_hex = os.urandom(8).hex()
    _, f_ext = os.path.splitext(form_picture.filename)
    picture_fn = random_hex + f_ext
    picture_path = os.path.join(app.config['UPLOAD_FOLDER'], picture_fn)
    
    # Resize image if needed
    output_size = (125, 125)
    i = Image.open(form_picture)
    i.thumbnail(output_size)
    i.save(picture_path)
    
    return picture_fn

# Message reaction routes
@app.route('/message/<int:message_id>/react', methods=['POST'])
@login_required
def react_to_message(message_id):
    data = request.get_json()
    emoji = data.get('emoji')
    
    if not emoji:
        return jsonify({'error': 'Emoji required'}), 400
    
    # Check if user already reacted with this emoji
    existing_reaction = MessageReaction.query.filter_by(
        message_id=message_id, 
        user_id=current_user.id,
        emoji=emoji
    ).first()
    
    if existing_reaction:
        # Remove the reaction
        db.session.delete(existing_reaction)
        db.session.commit()
        return jsonify({'action': 'removed'})
    else:
        # Remove any existing reaction by this user to this message
        MessageReaction.query.filter_by(
            message_id=message_id, 
            user_id=current_user.id
        ).delete()
        
        # Add new reaction
        reaction = MessageReaction(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.session.add(reaction)
        db.session.commit()
        
        # Emit socket event
        message = Message.query.get(message_id)
        if message:
            if message.group_id:
                socketio.emit('message_reaction', {
                    'message_id': message_id,
                    'user_id': current_user.id,
                    'emoji': emoji,
                    'action': 'added'
                }, room=str(message.group_id))
            else:
                # Direct message - notify both users
                socketio.emit('message_reaction', {
                    'message_id': message_id,
                    'user_id': current_user.id,
                    'emoji': emoji,
                    'action': 'added'
                }, room=str(message.sender_id))
                socketio.emit('message_reaction', {
                    'message_id': message_id,
                    'user_id': current_user.id,
                    'emoji': emoji,
                    'action': 'added'
                }, room=str(message.receiver_id))
        
        return jsonify({'action': 'added'})

@app.route('/message/<int:message_id>')
@login_required
def get_message(message_id):
    message = Message.query.get_or_404(message_id)
    
    # Check if user has permission to view this message
    if message.group_id:
        # Check if user is member of the group
        membership = GroupMember.query.filter_by(
            group_id=message.group_id,
            user_id=current_user.id
        ).first()
        if not membership:
            return jsonify({'error': 'Access denied'}), 403
    else:
        # Check if user is sender or receiver
        if message.sender_id != current_user.id and message.receiver_id != current_user.id:
            return jsonify({'error': 'Access denied'}), 403
    
    # Get reactions for this message
    reactions_data = []
    reactions = MessageReaction.query.filter_by(message_id=message_id).all()
    for reaction in reactions:
        reactions_data.append({
            'id': reaction.id,
            'user_id': reaction.user_id,
            'emoji': reaction.emoji,
            'user_name': reaction.user.username
        })
    
    # Get replied message if exists
    replied_message = None
    if message.reply_to_id:
        replied_msg = Message.query.get(message.reply_to_id)
        if replied_msg:
            replied_message = {
                'id': replied_msg.id,
                'content': replied_msg.content,
                'sender_name': replied_msg.sender.username,
                'message_type': replied_msg.message_type
            }
    
    return jsonify({
        'id': message.id,
        'content': message.content,
        'timestamp': message.timestamp.isoformat(),
        'sender_id': message.sender_id,
        'receiver_id': message.receiver_id,
        'group_id': message.group_id,
        'is_read': message.is_read,
        'message_type': message.message_type,
        'file_path': message.file_path,
        'sender_name': message.sender.username,
        'reactions': reactions_data,
        'reply_to': replied_message
    })

# Add socket event for reactions
@socketio.on('message_reaction')
def handle_message_reaction(data):
    message_id = data['message_id']
    emoji = data['emoji']
    action = data['action']  # 'added' or 'removed'
    
    # Update the message reactions in the database
    if action == 'added':
        # Remove any existing reaction by this user to this message
        MessageReaction.query.filter_by(
            message_id=message_id, 
            user_id=current_user.id
        ).delete()
        
        # Add new reaction
        reaction = MessageReaction(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        )
        db.session.add(reaction)
    else:
        # Remove the reaction
        MessageReaction.query.filter_by(
            message_id=message_id,
            user_id=current_user.id,
            emoji=emoji
        ).delete()
    
    db.session.commit()
    
    # Broadcast the reaction update
    message = Message.query.get(message_id)
    if message:
        if message.group_id:
            emit('reaction_update', {
                'message_id': message_id,
                'user_id': current_user.id,
                'user_name': current_user.username,
                'emoji': emoji,
                'action': action
            }, room=str(message.group_id))
        else:
            # Direct message - notify both users
            emit('reaction_update', {
                'message_id': message_id,
                'user_id': current_user.id,
                'user_name': current_user.username,
                'emoji': emoji,
                'action': action
            }, room=str(message.sender_id))
            emit('reaction_update', {
                'message_id': message_id,
                'user_id': current_user.id,
                'user_name': current_user.username,
                'emoji': emoji,
                'action': action
            }, room=str(message.receiver_id))

# Voice call socket events
@socketio.on('call_request')
def handle_call_request(data):
    receiver_id = data['to']
    caller_id = data['from']
    
    # Get caller info
    caller = User.query.get(caller_id)
    
    # Send call request to receiver
    emit('call_request', {
        'from': caller_id,
        'from_name': caller.username
    }, room=str(receiver_id))

@socketio.on('call_accepted')
def handle_call_accepted(data):
    receiver_id = data['to']  # The caller
    caller_id = data['from']  # The person who accepted
    
    # Notify the caller that the call was accepted
    emit('call_accepted', {
        'from': caller_id
    }, room=str(receiver_id))

@socketio.on('call_rejected')
def handle_call_rejected(data):
    receiver_id = data['to']  # The caller
    
    # Notify the caller that the call was rejected
    emit('call_rejected', room=str(receiver_id))

@socketio.on('call_ended')
def handle_call_ended(data):
    receiver_id = data['to']
    
    # Notify the other user that the call ended
    emit('call_ended', room=str(receiver_id))

@socketio.on('offer')
def handle_offer(data):
    receiver_id = data['to']
    
    # Forward the offer to the other user
    emit('offer', {
        'offer': data['offer'],
        'from': current_user.id
    }, room=str(receiver_id))

@socketio.on('answer')
def handle_answer(data):
    receiver_id = data['to']
    
    # Forward the answer to the other user
    emit('answer', {
        'answer': data['answer'],
        'from': current_user.id
    }, room=str(receiver_id))

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    receiver_id = data['to']
    
    # Forward the ICE candidate to the other user
    emit('ice_candidate', {
        'candidate': data['candidate'],
        'from': current_user.id
    }, room=str(receiver_id))

@app.route('/update_group/<int:group_id>', methods=['GET', 'POST'])
@login_required
def update_group(group_id):
    group = Group.query.get_or_404(group_id)

    # Only allow group creator or admin
    member = GroupMember.query.filter_by(group_id=group.id, user_id=current_user.id).first()
    if not member or not member.is_admin:
        flash('You do not have permission to update this group.', 'danger')
        return redirect(url_for('chats'))

    form = UpdateGroupForm(obj=group)

    if form.validate_on_submit():
        group.name = form.name.data
        group.description = form.description.data
        db.session.commit()
        flash('Group updated successfully!', 'success')
        return redirect(url_for('chats'))

    return render_template('update_group.html', form=form, group=group)

# Create database tables
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    socketio.run(app, debug=True)