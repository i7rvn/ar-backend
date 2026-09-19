// ═══════════════════════════════════════════════════════════════
// AR App — WebSocket Client (Frontend)
// ضع هذا الملف في frontend/src/services/websocket.js
// ═══════════════════════════════════════════════════════════════

class ARWebSocket {
 constructor() {
 this.ws = null;
 this.listeners = {};
 this.reconnectDelay = 1000;
 this.maxReconnect = 5;
 this.reconnectCount = 0;
 this.token = null;
 }

 // ─── الاتصال ────────────────────────────────────────────────
 connect(token) {
 this.token = token;
 const url = `${import.meta.env.VITE_WS_URL || 'wss://ar-app.dz'}/ws?token=${token}`;

 this.ws = new WebSocket(url);

 this.ws.onopen = () => {
 console.log(' WebSocket متصل');
 this.reconnectCount = 0;
 this.reconnectDelay = 1000;
 this.emit('connected', {});
 };

 this.ws.onmessage = (event) => {
 try {
 const data = JSON.parse(event.data);
 this.emit(data.type, data.payload);
 } catch (e) {
 console.error('خطأ في تحليل الرسالة:', e);
 }
 };

 this.ws.onclose = (event) => {
 console.log(' WebSocket انقطع');
 this.emit('disconnected', {});
 this.reconnect();
 };

 this.ws.onerror = (error) => {
 console.error('خطأ WebSocket:', error);
 };
 }

 // ─── إعادة الاتصال التلقائي ─────────────────────────────────
 reconnect() {
 if (this.reconnectCount >= this.maxReconnect) {
 console.log('تجاوز الحد الأقصى لإعادة الاتصال');
 return;
 }
 this.reconnectCount++;
 console.log(`إعادة الاتصال (${this.reconnectCount})...`);
 setTimeout(() => {
 this.connect(this.token);
 }, this.reconnectDelay);
 this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
 }

 // ─── إرسال حدث ──────────────────────────────────────────────
 send(type, payload) {
 if (this.ws?.readyState === WebSocket.OPEN) {
 this.ws.send(JSON.stringify({ type, payload }));
 }
 }

 // ─── الاستماع لأحداث ─────────────────────────────────────────
 on(event, callback) {
 if (!this.listeners[event]) this.listeners[event] = [];
 this.listeners[event].push(callback);
 }

 off(event, callback) {
 if (!this.listeners[event]) return;
 this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
 }

 emit(event, data) {
 (this.listeners[event] || []).forEach(cb => cb(data));
 }

 // ─── أوامر جاهزة ────────────────────────────────────────────

 joinConversation(conversationId) {
 this.send('join:room', { conversationId });
 }

 leaveConversation(conversationId) {
 this.send('leave:room', { conversationId });
 }

 startTyping(conversationId) {
 this.send('typing:start', { conversationId });
 }

 stopTyping(conversationId) {
 this.send('typing:stop', { conversationId });
 }

 markRead(conversationId) {
 this.send('message:read', { conversationId });
 }

 ping() {
 this.send('ping', {});
 }

 // ─── قطع الاتصال ────────────────────────────────────────────
 disconnect() {
 this.reconnectCount = this.maxReconnect; // منع إعادة الاتصال
 this.ws?.close();
 this.ws = null;
 }
}

// Singleton
const arWS = new ARWebSocket();
export default arWS;

// ─── مثال على الاستخدام في React ────────────────────────────
/*
import arWS from './services/websocket';

// عند تسجيل الدخول:
arWS.connect(localStorage.getItem('token'));

// الاستماع لرسائل جديدة:
arWS.on('message:new', (msg) => {
 setMessages(prev => [...prev, msg]);
});

// الاستماع لـ "يكتب الآن":
arWS.on('typing:start', ({ userId, conversationId }) => {
 setTyping({ userId, conversationId });
});

arWS.on('typing:stop', () => setTyping(null));

// الاستماع لإشعارات:
arWS.on('notification:new', (notif) => {
 showToast(notif.message);
 setUnreadCount(prev => prev + 1);
});

// الاستماع لمنشورات جديدة في الفيد:
arWS.on('post:new', (post) => {
 setNewPostsAvailable(true);
});

// الاستماع لحالة المستخدمين:
arWS.on('user:online', ({ userId }) => updateUserStatus(userId, true));
arWS.on('user:offline', ({ userId }) => updateUserStatus(userId, false));

// في صفحة المحادثة:
arWS.joinConversation(conversationId);

// عند الكتابة:
arWS.startTyping(conversationId);
setTimeout(() => arWS.stopTyping(conversationId), 3000);

// عند الخروج:
arWS.disconnect();
*/
