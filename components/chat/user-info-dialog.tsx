"use client";

import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Edit3, Check, Phone, MessageCircle, Clock, User } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  last_active: string;
  unread_count?: number;
  last_message_time?: string;
}

interface UserInfoDialogProps {
  user: ChatUser;
  isOpen: boolean;
  onClose: () => void;
  onUpdateName: (userId: string, customName: string) => Promise<void>;
}

export function UserInfoDialog({ user, isOpen, onClose, onUpdateName }: UserInfoDialogProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(user.custom_name || '');
  const [isUpdating, setIsUpdating] = useState(false);

  if (!isOpen) return null;

  const getDisplayName = () => {
    return user.custom_name || user.whatsapp_name || user.id;
  };

  const formatLastActive = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.abs(now.getTime() - date.getTime()) / (1000 * 60);

    if (diffInMinutes < 1) {
      return t('just_now');
    } else if (diffInMinutes < 60) {
      return t('minutes_ago', { count: Math.floor(diffInMinutes) });
    } else if (diffInMinutes < 1440) { // 24 hours
      const hours = Math.floor(diffInMinutes / 60);
      return t('hours_ago', { count: hours });
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      if (days < 7) {
        return t('days_ago', { count: days });
      } else {
        return date.toLocaleDateString([], {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
  };

  const handleSaveName = async () => {
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      await onUpdateName(user.id, editingName.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating name:', error);
      // Reset to original name on error
      setEditingName(user.custom_name || '');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingName(user.custom_name || '');
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setEditingName(user.custom_name || '');
    setIsEditing(true);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Dialog */}
        <div
          className="bg-background rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-semibold">{t('contact_info_title')}</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-full"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Avatar and Name Section */}
            <div className="flex flex-col items-center text-center space-y-4">
              <Avatar className="h-24 w-24">
                <AvatarFallback className="bg-green-100 text-green-700 font-semibold text-2xl">
                  {getDisplayName().charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Name Editing */}
              <div className="w-full space-y-2">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder={t('enter_custom_name')}
                      className="text-center"
                      disabled={isUpdating}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveName();
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveName}
                      disabled={isUpdating}
                      className="bg-green-600 hover:bg-green-700 text-white px-3"
                    >
                      {isUpdating ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancelEdit}
                      disabled={isUpdating}
                      className="px-3"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="text-2xl font-semibold">{getDisplayName()}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleStartEdit}
                      className="p-1 hover:bg-muted rounded-full"
                      title={t('edit_name')}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Information Cards */}
            <div className="space-y-4">
              {/* Phone Number */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{t('phone_number')}</p>
                  <p className="text-base font-mono">{user.id}</p>
                </div>
              </div>

              {/* WhatsApp Name */}
              {user.whatsapp_name && user.whatsapp_name !== user.id && (
                <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                  <MessageCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-muted-foreground">{t('whatsapp_name')}</p>
                    <p className="text-base">{user.whatsapp_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('whatsapp_name_info')}
                    </p>
                  </div>
                </div>
              )}

              {/* Custom Name */}
              {user.custom_name && (
                <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                  <User className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-muted-foreground">{t('custom_name')}</p>
                    <p className="text-base">{user.custom_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('custom_name_info')}
                    </p>
                  </div>
                </div>
              )}

              {/* Last Active */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{t('last_active_label')}</p>
                  <p className="text-base">{formatLastActive(user.last_active)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(user.last_active).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={onClose}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {t('done')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 