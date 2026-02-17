"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Users, Save, Loader2, Search, Upload, FileSpreadsheet, CheckCircle, PlusCircle, AlertCircle } from "lucide-react";

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
}

interface Group {
  group_id: string;
  group_name: string;
  description?: string;
  member_count: number;
  unread_count?: number;
}

interface ParsedExcelUser {
  userId: string;
  name: string;
  phone: string;
  isNew: boolean;
}

interface InvalidNumber {
  phone: string;
  reason: string;
}

interface ExcelParseResult {
  total: number;
  existing: number;
  new: number;
  invalid: number;
  users: ParsedExcelUser[];
  invalidNumbers?: InvalidNumber[];
}

interface GroupManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  users: ChatUser[];
  group?: Group | null; // If provided, we're editing; otherwise creating
  onGroupSaved: () => void;
}

export function GroupManagementDialog({
  isOpen,
  onClose,
  users,
  group,
  onGroupSaved,
}: GroupManagementDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [excelParseResult, setExcelParseResult] = useState<ExcelParseResult | null>(null);
  const [selectedExcelUserIds, setSelectedExcelUserIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing group data if editing
  useEffect(() => {
    if (group) {
      setName(group.group_name);
      setDescription(group.description || "");
      loadGroupMembers(group.group_id);
    } else {
      setName("");
      setDescription("");
      setSelectedUserIds([]);
      setShowExcelImport(false);
      setExcelParseResult(null);
      setSelectedExcelUserIds(new Set());
    }
  }, [group]);

  // Add Excel users to selected users when confirmed
  useEffect(() => {
    if (selectedExcelUserIds.size > 0) {
      setSelectedUserIds(prev => {
        const combined = new Set([...prev, ...selectedExcelUserIds]);
        return Array.from(combined);
      });
    }
  }, [selectedExcelUserIds]);

  // Reset Excel import state when opening a new group
  useEffect(() => {
    if (isOpen && !group) {
      setShowExcelImport(false);
      setExcelParseResult(null);
      setSelectedExcelUserIds(new Set());
    }
  }, [isOpen, group]);

  const loadGroupMembers = async (groupId: string) => {
    try {
      const response = await fetch(`/api/groups/${groupId}/members`);
      const data = await response.json();

      if (data.success && data.members) {
        setSelectedUserIds(data.members.map((m: { user_id: string }) => m.user_id));
      }
    } catch (error) {
      console.error('Error loading group members:', error);
    }
  };

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingExcel(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/groups/parse-excel', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse Excel file');
      }

      setExcelParseResult(data.data);

      // Auto-select all users (both existing and new)
      const allUserIds = data.data.users
        .filter((u: ParsedExcelUser) => u.userId)
        .map((u: ParsedExcelUser) => u.userId);
      setSelectedExcelUserIds(new Set(allUserIds));

    } catch (error) {
      console.error('Error parsing Excel:', error);
      setError(error instanceof Error ? error.message : 'Failed to parse Excel file');
    } finally {
      setIsUploadingExcel(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmExcelImport = () => {
    setShowExcelImport(false);
  };

  const handleCancelExcelImport = () => {
    setExcelParseResult(null);
    setSelectedExcelUserIds(new Set());
    setShowExcelImport(false);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }

    if (selectedUserIds.length === 0) {
      setError("Please select at least one member");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (group) {
        // Update existing group
        const updateResponse = await fetch(`/api/groups/${group.group_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description }),
        });

        if (!updateResponse.ok) {
          throw new Error('Failed to update group');
        }

        // Get current members
        const membersResponse = await fetch(`/api/groups/${group.group_id}/members`);
        const membersData = await membersResponse.json();
        const currentMemberIds = membersData.members?.map((m: { user_id: string }) => m.user_id) || [];

        // Find members to add and remove
        const toAdd = selectedUserIds.filter(id => !currentMemberIds.includes(id));
        const toRemove = currentMemberIds.filter((id: string) => !selectedUserIds.includes(id));

        // Add new members
        if (toAdd.length > 0) {
          await fetch(`/api/groups/${group.group_id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: toAdd }),
          });
        }

        // Remove members
        for (const userId of toRemove) {
          await fetch(`/api/groups/${group.group_id}/members?userId=${userId}`, {
            method: 'DELETE',
          });
        }
      } else {
        // Create new group
        const response = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description,
            memberIds: selectedUserIds,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to create group');
        }
      }

      onGroupSaved();
      onClose();
    } catch (error) {
      console.error('Error saving group:', error);
      setError(error instanceof Error ? error.message : 'Failed to save group');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-green-600" />
            <h2 className="text-2xl font-bold">
              {group ? 'Edit Group' : 'Create New Group'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Group Name */}
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name *</Label>
            <Input
              id="group-name"
              placeholder="e.g., VIP Customers, Weekly Newsletter"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="group-description">Description (Optional)</Label>
            <Textarea
              id="group-description"
              placeholder="Brief description of this group..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none"
            />
          </div>

          {/* Members Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select Members * ({selectedUserIds.length} selected)</Label>
              {!group && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowExcelImport(!showExcelImport)}
                  className="gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {showExcelImport ? 'Hide Excel Import' : 'Import from Excel'}
                </Button>
              )}
            </div>

            {/* Excel Import Panel */}
            {showExcelImport && !group && (
              <div className="border border-dashed border-border rounded-lg p-6 bg-muted/30 space-y-4">
                {!excelParseResult ? (
                  <>
                    <div className="text-center space-y-3">
                      <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                        <FileSpreadsheet className="h-6 w-6 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold">Import Members from Excel</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Upload an Excel (.xlsx, .xls) or CSV file containing phone numbers
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">File format requirements:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Column named "phone", "mobile", "number", or "whatsapp"</li>
                        <li>Optional column for names: "name" or "fullname"</li>
                        <li>Phone numbers must have at least 10 digits</li>
                        <li>Phone numbers cannot start with 0</li>
                      </ul>
                    </div>

                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleExcelUpload}
                        className="hidden"
                        id="excel-upload"
                      />
                      <Button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploadingExcel}
                        className="w-full"
                      >
                        {isUploadingExcel ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Parsing...
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload Excel File
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Import Results</h3>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelExcelImport}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="bg-background rounded-lg p-2 border">
                        <div className="text-xl font-bold text-foreground">
                          {excelParseResult.total}
                        </div>
                        <div className="text-xs text-muted-foreground">Valid</div>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-2 border border-blue-200 dark:border-blue-900">
                        <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                          {excelParseResult.existing}
                        </div>
                        <div className="text-xs text-muted-foreground">Existing</div>
                      </div>
                      <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-2 border border-green-200 dark:border-green-900">
                        <div className="text-xl font-bold text-green-600 dark:text-green-400">
                          {excelParseResult.new}
                        </div>
                        <div className="text-xs text-muted-foreground">New</div>
                      </div>
                      {excelParseResult.invalid > 0 && (
                        <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-2 border border-red-200 dark:border-red-900">
                          <div className="text-xl font-bold text-red-600 dark:text-red-400">
                            {excelParseResult.invalid}
                          </div>
                          <div className="text-xs text-muted-foreground">Invalid</div>
                        </div>
                      )}
                    </div>

                    {/* Users List */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">
                          {excelParseResult.total} users will be added ({excelParseResult.existing} existing, {excelParseResult.new} new)
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                        {excelParseResult.users.map((u, i) => (
                          <div key={i} className="flex items-center justify-between p-2 text-sm">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {u.isNew ? (
                                <PlusCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                              ) : (
                                <CheckCircle className="h-3 w-3 text-blue-600 flex-shrink-0" />
                              )}
                              <span className="truncate">{u.name}</span>
                            </div>
                            <span className="text-muted-foreground text-xs ml-2">{u.phone}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Invalid Numbers List */}
                    {excelParseResult.invalid > 0 && excelParseResult.invalidNumbers && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600" />
                          <span className="text-sm font-medium text-red-600">
                            {excelParseResult.invalid} invalid number(s) skipped
                          </span>
                        </div>
                        <div className="max-h-32 overflow-y-auto border border-red-200 dark:border-red-900 rounded-lg divide-y">
                          {excelParseResult.invalidNumbers.map((inv, i) => (
                            <div key={i} className="flex items-center justify-between p-2 text-sm">
                              <span className="text-muted-foreground">{inv.phone}</span>
                              <span className="text-xs text-red-500">{inv.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelExcelImport}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleConfirmExcelImport}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        Add {excelParseResult.total} Members
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* User List */}
            <div className="border border-border rounded-lg max-h-64 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No users found
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredUsers.map(user => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedUserIds.includes(user.id)}
                        onCheckedChange={() => handleToggleUser(user.id)}
                      />
                      <div className="flex-1">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-muted-foreground">{user.id}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {group ? 'Update Group' : 'Create Group'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

