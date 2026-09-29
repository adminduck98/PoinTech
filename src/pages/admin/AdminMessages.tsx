import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Send, User, Clock, Search } from 'lucide-react';
import { useAdminConversations, useAdminOrderMessages, useAdminSendMessage, useAdminMarkMessagesRead } from '../../lib/supabase/hooks';
import { getCurrentAdmin } from '../../lib/auth';
import { formatDateTime } from '../../lib/utils';
import { toast } from '../../components/Toast';
import { getAdminSession } from '../../lib/adminApi';

interface Conversation {
  order_id: string;
  order_number: string;
  customer_name: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  customer_telegram_id: number;
}

interface Message {
  id: string;
  sender_type: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

export const AdminMessages = () => {
  const admin = getCurrentAdmin();
  const { data: conversations = [], isLoading } = useAdminConversations();
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendMessage = useAdminSendMessage();
  const markRead = useAdminMarkMessagesRead();

  const { data: messages = [] } = useAdminOrderMessages(selectedOrder);

  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c: Conversation) => {
        const q = searchQuery.toLowerCase();
        return (
          c.order_number?.toLowerCase().includes(q) ||
          c.customer_name?.toLowerCase().includes(q) ||
          c.last_message?.toLowerCase().includes(q)
        );
      })
    : conversations;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (selectedOrder && admin) {
      markRead.mutate({ order_id: selectedOrder });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder, admin]);

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedOrder || sending) return;
    setSending(true);
    try {
      await sendMessage.mutateAsync({
        order_id: selectedOrder,
        content: messageInput.trim(),
      });
      setMessageInput('');
      toast.success('Сообщение отправлено');
    } catch {
      toast.error('Ошибка отправки сообщения');
      setSending(false);
      return;
    }

    // Send Telegram notification (fire-and-forget, separate from message save)
    try {
      const conv = conversations.find((c: Conversation) => c.order_id === selectedOrder);
      if (conv) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const admin_session = getAdminSession();
        fetch(`${supabaseUrl}/functions/v1/send-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'Apikey': anonKey,
          },
          body: JSON.stringify({
            telegram_user_id: conv.customer_telegram_id,
            message: `💬 <b>Новое сообщение по заказу #${selectedOrder.slice(0, 8).toUpperCase()}</b>\n\n${messageInput.trim()}`,
            parse_mode: 'HTML',
            admin_session,
          }),
        }).catch(() => {});
      }
    } catch {
      // Telegram notification is optional, don't block UI
    }

    setSending(false);
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 glass border-b border-[color:var(--glass-border)]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            to="/nanyy/dashboard"
            className="p-2 rounded-lg hover:bg-surface-muted transition"
          >
            <ArrowLeft className="w-5 h-5 text-text" />
          </Link>
          <MessageSquare className="w-5 h-5 text-text" />
          <div>
            <h1 className="text-lg font-bold text-text">Сообщения</h1>
            <p className="text-xs text-text-secondary">
              {conversations.length} {conversations.length === 1 ? 'диалог' : 'диалогов'}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex" style={{ height: 'calc(100dvh - 73px)' }}>
        {/* Conversations list */}
        <div className={`w-full sm:w-80 border-r border-border bg-surface flex flex-col ${selectedOrder ? 'hidden sm:flex' : 'flex'}`}>
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по номеру, имени..."
                className="input-premium w-full pl-9 pr-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="w-6 h-6 border-3 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageSquare className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                <p className="text-sm text-text-secondary">
                  {searchQuery ? 'Ничего не найдено' : 'Нет диалогов'}
                </p>
              </div>
            ) : (
              filteredConversations.map((conv: Conversation) => (
                <button
                  key={conv.order_id}
                  onClick={() => setSelectedOrder(conv.order_id)}
                  className={`w-full text-left px-4 py-3 border-b border-border-subtle hover:bg-surface-muted/50 transition ${
                    selectedOrder === conv.order_id ? 'bg-surface-muted' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text truncate">
                          {conv.customer_name}
                        </p>
                        {conv.unread_count > 0 && (
                          <span className="px-1.5 py-0.5 bg-accent text-text-inverse text-[10px] font-bold rounded-full">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5 flex items-center gap-1">
                        Заказ #{conv.order_number}
                      </p>
                      <p className="text-xs text-text-secondary mt-1 truncate">
                        {conv.last_message}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {conv.last_message_at ? formatDateTime(conv.last_message_at, 'ru') : ''}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className={`flex-1 flex flex-col bg-bg ${!selectedOrder ? 'hidden sm:flex' : 'flex'}`}>
          {!selectedOrder ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
                <p className="text-sm text-text-secondary">
                  Выберите диалог для начала общения
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 bg-surface border-b border-border flex items-center gap-3">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="sm:hidden p-1.5 rounded-lg hover:bg-surface-muted transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-full bg-surface-muted flex items-center justify-center">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text">
                    {conversations.find((c: Conversation) => c.order_id === selectedOrder)?.customer_name || 'Покупатель'}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Заказ #{selectedOrder.slice(0, 8).toUpperCase()}
                  </p>
                </div>
                <Link
                  to={`/nanyy/orders`}
                  className="text-xs text-accent hover:text-accent-hover font-medium transition"
                >
                  К заказу
                </Link>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="text-center py-12">
                    <MessageSquare className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm text-text-tertiary">
                      Нет сообщений. Напишите первое сообщение покупателю.
                    </p>
                  </div>
                )}
                {messages.map((msg: Message) => {
                  const isAdmin = msg.sender_type === 'admin';
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                          isAdmin
                            ? 'bg-accent text-text-inverse rounded-br-md'
                            : 'bg-surface text-text rounded-bl-md border border-border'
                        }`}
                      >
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${isAdmin ? 'text-text-inverse/60' : 'text-text-tertiary'}`}>
                          {formatDateTime(msg.created_at, 'ru')}
                          {isAdmin && msg.is_read && ' ✓✓'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="bg-surface border-t border-border flex-shrink-0" style={{ padding: '12px 16px' }}>
                <div className="flex items-center gap-2">
                  <input
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Введите сообщение..."
                    className="flex-1 rounded-xl text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent dark:focus:ring-surface-400"
                    style={{
                      padding: '10px 14px',
                      background: 'var(--tw-prose-pre-bg, rgb(244 244 245))',
                      border: '1px solid var(--tw-prose-pre-border, rgb(228 228 231))',
                      minHeight: '44px',
                      fontSize: '16px',
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!messageInput.trim() || sending}
                    className="rounded-xl btn-brand disabled:opacity-50 flex items-center justify-center flex-shrink-0"
                    style={{ width: '44px', height: '44px' }}
                  >
                    {sending ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 text-text-inverse" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
