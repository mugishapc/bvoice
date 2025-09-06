from datetime import datetime
from extensions import db, login_manager
from flask_login import UserMixin

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(20), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(60), nullable=False)
    profile_picture = db.Column(db.String(20), nullable=False, default='default.jpg')
    status = db.Column(db.Text, nullable=True)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    push_subscription = db.Column(db.Text, nullable=True)
    
    # Relationships
    sent_messages = db.relationship('Message', foreign_keys='Message.sender_id', backref='sender', lazy=True)
    received_messages = db.relationship('Message', foreign_keys='Message.receiver_id', backref='receiver', lazy=True)
    groups = db.relationship('GroupMember', backref='user', lazy=True)
    reactions = db.relationship('MessageReaction', backref='user', lazy=True)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False)
    message_type = db.Column(db.String(10), default='text')  # text, image, file, etc.
    file_path = db.Column(db.String(100), nullable=True)
    
    # Foreign keys
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=True)
    reply_to_id = db.Column(db.Integer, db.ForeignKey('message.id'), nullable=True)
    
    # Relationships
    replies = db.relationship('Message', backref=db.backref('reply_to', remote_side=[id]))
    reactions = db.relationship('MessageReaction', backref='message', lazy=True)

class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    profile_picture = db.Column(db.String(200), default='group_default.png')  # ✅ Ensure this line exists

    messages = db.relationship('Message', backref='group', lazy=True)
    members = db.relationship('GroupMember', backref='group', lazy=True)

class GroupMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

class MessageReaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey('message.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    emoji = db.Column(db.String(10), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)