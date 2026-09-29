import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { useOrderMessages, useSendMessage, useMarkMessagesRead } from '../lib/supabase/hooks';
import { isTelegramWebApp } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { useTranslation } from '../hooks/useTranslation';
import { formatDateTime } from '../lib/utils';
import { Portal } from './Portal';

interface ChatModalProps {
  orderId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ChatModal = ({ orderId, isOpen, onClose }: ChatModalProps) => {
  const { language } = useTranslation();
  const userId = useUserId();
  const { data: messages = [] } = useOrderMessages(orderId);
  const sendMessage = useSendMessage();
  const markRead = useMarkMessagesRead();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && userId) {
      markRead.mutate({ order_id: orderId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, orderId, userId]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const content = input.trim();
    try {
      await sendMessage.mutateAsync({ order_id: orderId, content });
      setInput('');
      // The admin's Telegram ping is sent by the client-api `send_message`
      // action. It used to be fired from here with a hard-coded admin chat id
      // against an unauthenticated endpoint, which let anyone use the shop's
      // bot to message arbitrary users.
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-end sm:items-center justify-center pointer-events-auto"
        style={{ zIndex: 2147483647, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          className="bg-surface rounded-t-2xl sm:rounded-2xl w-full flex flex-col shadow-2xl mx-0 sm:mx-4"
          style={{
            maxWidth: '28rem',
            height: isTelegramWebApp() ? '85dvh' : 'min(65dvh, 32rem)',
            pointerEvents: 'auto',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-text" />
              <h3 className="font-semibold text-text text-sm">
                {language === 'ru' ? 'Чат с магазином' : "Do'kon bilan chat"}
              </h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors">
              <X className="w-4 h-4 text-text-tertiary" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
            {messages.length === 0 && (
              <div className="text-center py-12">
                <MessageSquare className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                <p className="text-sm text-text-tertiary">
                  {language === 'ru' ? 'Напишите сообщение, чтобы начать диалог' : "Gap boshlash uchun xabar yozing"}
                </p>
              </div>
            )}
            {messages.map((msg: { id: string; sender_type: string; sender_id: string; content: string; created_at: string; is_read: boolean }) => {
              const isCustomer = msg.sender_type === 'customer';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                      isCustomer
                        ? 'bg-accent text-text-inverse rounded-br-md'
                        : 'bg-surface-muted text-text rounded-bl-md'
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${isCustomer ? 'text-text-inverse/60' : 'text-text-tertiary'}`}>
                      {formatDateTime(msg.created_at, language)}
                      {isCustomer && msg.is_read && ' ✓✓'}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            className="border-t border-border flex-shrink-0 bg-surface"
            style={{
              padding: '12px 16px',
              paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
            }}
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={language === 'ru' ? 'Сообщение...' : 'Xabar...'}
                className="input-premium flex-1 text-sm bg-surface-muted"
                style={{ padding: '10px 14px', minHeight: '44px', fontSize: '16px' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="rounded-xl bg-accent hover:bg-surface-elevated disabled:opacity-50 flex items-center justify-center transition-colors flex-shrink-0"
                style={{ width: '44px', height: '44px' }}
              >
                <Send className="w-4 h-4 text-text-inverse" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};
