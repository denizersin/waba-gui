"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Search, MessageCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface ChatUser {
  id: string;
  name: string;
  last_active: string;
  last_message?: string;
  last_message_time?: string;
  last_message_type?: string;
  last_message_sender?: string;
  unread_count?: number;
}

interface UserListProps {
  users: ChatUser[];
  selectedUser: ChatUser | null;
  onUserSelect: (user: ChatUser) => void;
  currentUserId: string;
}

export function UserList({ users, selectedUser, onUserSelect, currentUserId }: UserListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const supabase = createClient();
  const router = useRouter();

  // Sort users by last message time (most recent first) and then by unread count
  const sortedUsers = users
    .filter(user => user.id !== currentUserId)
    .sort((a, b) => {
      // First, prioritize users with unread messages
      if ((a.unread_count || 0) > 0 && (b.unread_count || 0) === 0) return -1;
      if ((a.unread_count || 0) === 0 && (b.unread_count || 0) > 0) return 1;
      
      // Then sort by last message time
      const aTime = new Date(a.last_message_time || a.last_active).getTime();
      const bTime = new Date(b.last_message_time || b.last_active).getTime();
      return bTime - aTime;
    });

  const filteredUsers = sortedUsers.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const getMessagePreview = (user: ChatUser) => {
    if (!user.last_message && !user.last_message_type) {
      return "No messages yet";
    }

    // Handle media messages
    if (user.last_message_type && user.last_message_type !== 'text') {
      const isFromCurrentUser = user.last_message_sender === currentUserId;
      const prefix = isFromCurrentUser ? "You: " : "";
      
      switch (user.last_message_type) {
        case 'image':
          return `${prefix}📷 Photo`;
        case 'video':
          return `${prefix}🎥 Video`;
        case 'audio':
          return `${prefix}🎵 Audio`;
        case 'document':
          return `${prefix}📄 Document`;
        default:
          return `${prefix}📎 Media`;
      }
    }

    // Handle text messages
    const message = user.last_message || "";
    const isFromCurrentUser = user.last_message_sender === currentUserId;
    const prefix = isFromCurrentUser ? "You: " : "";
    
    return `${prefix}${message.length > 30 ? message.substring(0, 30) + "..." : message}`;
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border bg-green-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6" />
            <h1 className="text-lg font-semibold">WhatsApp</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="[&>button]:text-white [&>button]:hover:bg-green-700">
              <ThemeSwitcher />
            </div>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-green-700 rounded-full transition-colors"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto">
        {filteredUsers.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchTerm ? "No conversations found" : "No conversations yet"}
          </div>
        ) : (
          filteredUsers.map((user) => (
            <div
              key={user.id}
              onClick={() => onUserSelect(user)}
              className={`p-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors ${
                selectedUser?.id === user.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-green-100 text-green-700 font-semibold">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className={`font-medium truncate ${
                      (user.unread_count || 0) > 0 ? "font-semibold" : ""
                    }`}>
                      {user.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTime(user.last_message_time || user.last_active)}
                      </span>
                      {(user.unread_count || 0) > 0 && (
                        <div className="bg-green-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                          {user.unread_count! > 99 ? '99+' : user.unread_count}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <p className={`text-sm text-muted-foreground truncate mt-1 ${
                    (user.unread_count || 0) > 0 ? "font-medium text-foreground" : ""
                  }`}>
                    {getMessagePreview(user)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}