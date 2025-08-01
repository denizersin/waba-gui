"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserList } from "@/components/chat/user-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { User } from "@supabase/supabase-js";

interface ChatUser {
  id: string;
  name: string;
  last_active: string;
  unread_count?: number; // Added for unread count
  last_message_time?: string; // Added for last message time
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  timestamp: string;
  is_sent_by_me: boolean;
  message_type?: string;
  media_data?: string | null;
}

export default function ChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const supabase = createClient();

  // Check screen size for responsive behavior
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Handle ESC key press to close chat window
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isMobile && showChat) {
          // On mobile, go back to user list
          handleBackToUsers();
        } else if (!isMobile && selectedUser) {
          // On desktop, close chat window
          setSelectedUser(null);
          setMessages([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, showChat, selectedUser]);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  // Subscribe to users table for real-time updates
  useEffect(() => {
    if (!user) return;

    const fetchUsers = async () => {
      // Use the new user_conversations view instead of users table
      const { data } = await supabase
        .from('user_conversations')
        .select('*')
        .order('last_message_time', { ascending: false });
      
      if (data) {
        console.log('Fetched user conversations:', data);
        setUsers(data);
      }
    };

    fetchUsers();

    // Set up real-time subscription for users table changes
    const usersSubscription = supabase
      .channel('users-channel')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'users' 
      }, (payload) => {
        console.log('Users table change:', payload);
        // Refresh the conversations view when users table changes
        fetchUsers();
      })
      .subscribe();

    // Set up real-time subscription for messages table changes
    const messagesSubscription = supabase
      .channel('messages-global-channel')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => {
        console.log('Messages table change:', payload);
        // Refresh the conversations view when messages table changes
        fetchUsers();
      })
      .subscribe();

    return () => {
      usersSubscription.unsubscribe();
      messagesSubscription.unsubscribe();
    };
  }, [user]);

  // Subscribe to messages for selected user with improved real-time handling
  useEffect(() => {
    if (!selectedUser || !user) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      console.log(`Fetching messages between ${user.id} and ${selectedUser.id}`);
      
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${user.id})`)
        .order('timestamp', { ascending: true });
      
      if (error) {
        console.error('Error fetching messages:', error);
      } else {
        console.log(`Fetched ${data?.length || 0} messages`);
        setMessages(data || []);
      }
    };

    fetchMessages();

    // Set up real-time subscription for messages with a unique channel name
    const channelName = `messages-${user.id}-${selectedUser.id}`;
    const messagesSubscription = supabase
      .channel(channelName)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        console.log('New message received:', payload);
        
        const newMessage = payload.new as Message;
        
        // Check if this message belongs to the current conversation
        const isRelevantMessage = 
          (newMessage.sender_id === user.id && newMessage.receiver_id === selectedUser.id) ||
          (newMessage.sender_id === selectedUser.id && newMessage.receiver_id === user.id);
        
        if (isRelevantMessage) {
          console.log('Adding message to conversation');
          setMessages((prev) => {
            // Avoid duplicates
            const exists = prev.find(m => m.id === newMessage.id);
            if (exists) return prev;
            
            // Insert message in correct chronological order
            const newMessages = [...prev, newMessage];
            return newMessages.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });
        }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        console.log('Message updated:', payload);
        
        const updatedMessage = payload.new as Message;
        
        // Check if this message belongs to the current conversation
        const isRelevantMessage = 
          (updatedMessage.sender_id === user.id && updatedMessage.receiver_id === selectedUser.id) ||
          (updatedMessage.sender_id === selectedUser.id && updatedMessage.receiver_id === user.id);
        
        if (isRelevantMessage) {
          setMessages((prev) => 
            prev.map(m => m.id === updatedMessage.id ? updatedMessage : m)
          );
        }
      })
      .subscribe();

    console.log(`Subscribed to messages channel: ${channelName}`);

    return () => {
      console.log(`Unsubscribing from messages channel: ${channelName}`);
      messagesSubscription.unsubscribe();
    };
  }, [selectedUser, user]);

  // Handle user selection and mark messages as read
  const handleUserSelect = async (selectedUser: ChatUser) => {
    console.log('User selected:', selectedUser);
    setSelectedUser(selectedUser);
    
    // Mark messages as read when opening a conversation
    if (selectedUser.unread_count && selectedUser.unread_count > 0) {
      try {
        const response = await fetch('/api/messages/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            otherUserId: selectedUser.id
          }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`Marked ${result.markedCount} messages as read`);
          
          // Update the user's unread count locally
          setUsers(prev => prev.map(u => 
            u.id === selectedUser.id 
              ? { ...u, unread_count: 0 }
              : u
          ));
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    }

    if (!isMobile) {
      setShowChat(true);
    } else {
      setShowChat(true);
    }
  };

  const handleBackToUsers = useCallback(() => {
    setShowChat(false);
    setSelectedUser(null);
    setMessages([]);
  }, []);

  const handleSendMessage = async (content: string) => {
    if (!selectedUser || !user || sendingMessage) return;

    setSendingMessage(true);
    
    try {
      console.log(`Sending message to ${selectedUser.id}: ${content}`);
      
      // Call the WhatsApp API endpoint which handles both WhatsApp sending and database storage
      const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: selectedUser.id,
          message: content,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      console.log('Message sent successfully:', result);
      
      // The message will be automatically added to the UI via real-time subscription
      // No need to manually update the messages state here
      
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Show error to user (you might want to add a toast notification here)
      alert(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Fallback: Store in database only if WhatsApp API fails
      try {
        const fallbackMessage = {
          id: `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sender_id: user.id,
          receiver_id: selectedUser.id,
          content,
          timestamp: new Date().toISOString(),
          is_sent_by_me: true,
          message_type: 'text',
          media_data: null
        };

        const { error: dbError } = await supabase
          .from('messages')
          .insert([fallbackMessage]);

        if (dbError) {
          console.error('Fallback database storage also failed:', dbError);
        } else {
          console.log('Message stored in database as fallback');
        }
      } catch (fallbackError) {
        console.error('Fallback storage failed:', fallbackError);
      }
    } finally {
      setSendingMessage(false);
    }
  };

  if (!user) {
  return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-background">
      {/* Desktop Layout */}
      {!isMobile && (
        <>
          {/* User List - Desktop */}
          <div className="w-1/3 border-r border-border">
            <UserList 
              users={users}
              selectedUser={selectedUser}
              onUserSelect={handleUserSelect}
              currentUserId={user.id}
            />
          </div>
          
          {/* Chat Window - Desktop */}
          <div className="flex-1">
            <ChatWindow
              selectedUser={selectedUser}
              messages={messages}
              onSendMessage={handleSendMessage}
              currentUserId={user.id}
              isLoading={sendingMessage}
              onClose={() => {
                setSelectedUser(null);
                setMessages([]);
              }}
            />
          </div>
        </>
      )}

      {/* Mobile Layout */}
      {isMobile && (
        <>
          {!showChat ? (
            // User List - Mobile
            <div className="w-full">
              <UserList 
                users={users}
                selectedUser={selectedUser}
                onUserSelect={handleUserSelect}
                currentUserId={user.id}
              />
      </div>
          ) : (
            // Chat Window - Mobile
            <div className="w-full">
              <ChatWindow
                selectedUser={selectedUser}
                messages={messages}
                onSendMessage={handleSendMessage}
                onBack={handleBackToUsers}
                currentUserId={user.id}
                isMobile={true}
                isLoading={sendingMessage}
              />
      </div>
          )}
        </>
      )}
    </div>
  );
}
