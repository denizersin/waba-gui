"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Search, Send, Loader2, AlertCircle, FileText, Eye, Upload, ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import Image from "next/image";

// Template types
interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: ButtonComponent[];
}

interface ButtonComponent {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
}

interface FormattedComponents {
  header: TemplateComponent | null;
  body: TemplateComponent | null;
  footer: TemplateComponent | null;
  buttons: ButtonComponent[];
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: TemplateComponent[];
  previous_category?: string;
  rejected_reason?: string;
  quality_score?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status_color: string;
  category_icon: string;
  formatted_components: FormattedComponents;
}

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  last_active: string;
}

interface TemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSendTemplate: (templateName: string, templateData: WhatsAppTemplate, variables: {
    header: Record<string, string>;
    body: Record<string, string>;
    footer: Record<string, string>;
  }, headerImage?: File | null) => Promise<void>;
  selectedUser: ChatUser;
}

export function TemplateSelector({ isOpen, onClose, onSendTemplate, selectedUser }: TemplateSelectorProps) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<WhatsAppTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [variables, setVariables] = useState<{
    header: Record<string, string>;
    body: Record<string, string>;
    footer: Record<string, string>;
  }>({
    header: {},
    body: {},
    footer: {}
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [headerImagePreview, setHeaderImagePreview] = useState<string | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const headerImageInputRef = useRef<HTMLInputElement>(null);

  // Fetch templates when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen]);

  // Filter templates based on search
  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = templates.filter(template =>
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTemplates(filtered);
    } else {
      setFilteredTemplates(templates);
    }
  }, [templates, searchTerm]);

  const fetchTemplates = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/templates?status=APPROVED');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t('failed_load_templates'));
      }

      setTemplates(result.data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      setError(error instanceof Error ? error.message : t('failed_load_templates'));
    } finally {
      setIsLoading(false);
    }
  };

  const extractVariables = (template: WhatsAppTemplate): {
    header: string[];
    body: string[];
    footer: string[];
    all: string[];
  } => {
    const headerVariables: string[] = [];
    const bodyVariables: string[] = [];
    const footerVariables: string[] = [];

    template.components.forEach(component => {
      if (component.text) {
        // Extract variables like {{1}}, {{2}}, etc.
        const matches = component.text.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          const componentVariables = matches.map(match => match.replace(/[{}]/g, ''));

          switch (component.type) {
            case 'HEADER':
              componentVariables.forEach(variable => {
                if (!headerVariables.includes(variable)) {
                  headerVariables.push(variable);
                }
              });
              break;
            case 'BODY':
              componentVariables.forEach(variable => {
                if (!bodyVariables.includes(variable)) {
                  bodyVariables.push(variable);
                }
              });
              break;
            case 'FOOTER':
              componentVariables.forEach(variable => {
                if (!footerVariables.includes(variable)) {
                  footerVariables.push(variable);
                }
              });
              break;
          }
        }
      }
    });

    // Sort variables numerically
    headerVariables.sort((a, b) => parseInt(a) - parseInt(b));
    bodyVariables.sort((a, b) => parseInt(a) - parseInt(b));
    footerVariables.sort((a, b) => parseInt(a) - parseInt(b));

    // Get all unique variables
    const allVariables = [...new Set([...headerVariables, ...bodyVariables, ...footerVariables])]
      .sort((a, b) => parseInt(a) - parseInt(b));

    return {
      header: headerVariables,
      body: bodyVariables,
      footer: footerVariables,
      all: allVariables
    };
  };

  const renderTemplatePreview = (template: WhatsAppTemplate, vars: {
    header: Record<string, string>;
    body: Record<string, string>;
    footer: Record<string, string>;
  }) => {
    const replaceVariables = (text: string, componentVars: Record<string, string>) => {
      let result = text;
      Object.entries(componentVars).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || `{{${key}}}`);
      });
      return result;
    };

    return (
      <div className="bg-gradient-to-br from-green-50 to-blue-50 dark:from-green-950/20 dark:to-blue-950/20 rounded-lg p-4">
        <div className="max-w-sm mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-green-500 text-white p-4 rounded-2xl m-4">
            {/* Header */}
            {template.formatted_components.header && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-white opacity-60"></div>
                  <span className="text-xs opacity-75 font-medium uppercase tracking-wide">{t('preview_header')}</span>
                </div>
                {template.formatted_components.header.format === 'IMAGE' ? (
                  <div className="bg-white bg-opacity-20 rounded-lg p-3 text-center mb-2">
                    <span className="text-sm">📷 {t('header_image')}</span>
                  </div>
                ) : template.formatted_components.header.format === 'VIDEO' ? (
                  <div className="bg-white bg-opacity-20 rounded-lg p-3 text-center mb-2">
                    <span className="text-sm">🎥 {t('header_video')}</span>
                  </div>
                ) : template.formatted_components.header.format === 'DOCUMENT' ? (
                  <div className="bg-white bg-opacity-20 rounded-lg p-3 text-center mb-2">
                    <span className="text-sm">📄 {t('header_document')}</span>
                  </div>
                ) : template.formatted_components.header.text ? (
                  <p className="font-semibold text-sm mb-2">
                    {replaceVariables(template.formatted_components.header.text, vars.header)}
                  </p>
                ) : (
                  <p className="font-semibold text-sm mb-2">[{t('header_content')}]</p>
                )}
              </div>
            )}

            {/* Body */}
            {template.formatted_components.body && (
              <div className="mb-3">
                {template.formatted_components.header && (
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-white opacity-60"></div>
                    <span className="text-xs opacity-75 font-medium uppercase tracking-wide">{t('preview_body')}</span>
                  </div>
                )}
                <p className="text-sm leading-relaxed">
                  {replaceVariables(template.formatted_components.body.text || '', vars.body)}
                </p>
              </div>
            )}

            {/* Footer */}
            {template.formatted_components.footer && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-white opacity-60"></div>
                  <span className="text-xs opacity-75 font-medium uppercase tracking-wide">{t('preview_footer')}</span>
                </div>
                <p className="text-xs opacity-75">
                  {replaceVariables(template.formatted_components.footer.text || '', vars.footer)}
                </p>
              </div>
            )}

            {/* Buttons */}
            {template.formatted_components.buttons.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-white opacity-60"></div>
                  <span className="text-xs opacity-75 font-medium uppercase tracking-wide">{t('preview_buttons')}</span>
                </div>
                <div className="space-y-1">
                  {template.formatted_components.buttons.map((button, index) => (
                    <div
                      key={index}
                      className="bg-white bg-opacity-20 rounded-lg p-2 text-center"
                    >
                      <div className="flex items-center justify-center gap-2">
                        {button.type === 'URL' && <span>🔗</span>}
                        {button.type === 'PHONE_NUMBER' && <span>📞</span>}
                        {button.type === 'QUICK_REPLY' && <span>💬</span>}
                        <span className="text-sm font-medium">{button.text}</span>
                      </div>
                      {button.url && (
                        <div className="text-xs opacity-60 mt-1 truncate">
                          {button.url}
                        </div>
                      )}
                      {button.phone_number && (
                        <div className="text-xs opacity-60 mt-1">
                          {button.phone_number}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs opacity-75 text-right mt-3">
              12:34 PM
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Helper: does this template have an IMAGE header?
  const hasImageHeader = (template: WhatsAppTemplate): boolean => {
    return template.components.some(
      (c) => c.type === 'HEADER' && c.format === 'IMAGE'
    );
  };

  const handleHeaderImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('Image file size exceeds 25MB limit');
      return;
    }
    setHeaderImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setHeaderImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setError(null);
  }, []);

  const handleImageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingImage(true);
  }, []);

  const handleImageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingImage(false);
  }, []);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingImage(false);
    const file = e.dataTransfer.files[0];
    if (file) handleHeaderImageSelect(file);
  }, [handleHeaderImageSelect]);

  const handleTemplateSelect = (template: WhatsAppTemplate) => {
    setSelectedTemplate(template);
    setShowPreview(false);
    setHeaderImageFile(null);
    setHeaderImagePreview(null);

    // Initialize variables
    const templateVars = extractVariables(template);
    const initialVars: Record<string, string> = {};
    templateVars.all.forEach(variable => {
      initialVars[variable] = '';
    });
    setVariables({
      header: {},
      body: {},
      footer: {}
    });
  };

  const handleSendTemplate = async () => {
    if (!selectedTemplate) return;

    // Validate required variables per component
    const templateVars = extractVariables(selectedTemplate);
    const missingVars: string[] = [];

    // Check if IMAGE header is required but not uploaded
    if (hasImageHeader(selectedTemplate) && !headerImageFile) {
      setError(t('header_image_missing'));
      return;
    }

    // Check header variables
    templateVars.header.forEach(variable => {
      if (!variables.header[variable]?.trim()) {
        missingVars.push(`Header {{${variable}}}`);
      }
    });

    // Check body variables
    templateVars.body.forEach(variable => {
      if (!variables.body[variable]?.trim()) {
        missingVars.push(`Body {{${variable}}}`);
      }
    });

    // Check footer variables
    templateVars.footer.forEach(variable => {
      if (!variables.footer[variable]?.trim()) {
        missingVars.push(`Footer {{${variable}}}`);
      }
    });

    if (missingVars.length > 0) {
      setError(t('fill_all_variables', { vars: missingVars.join(', ') }));
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      await onSendTemplate(
        selectedTemplate.name,
        selectedTemplate,
        variables,
        headerImageFile
      );

      // Reset state and close
      setSelectedTemplate(null);
      setVariables({
        header: {},
        body: {},
        footer: {}
      });
      setHeaderImageFile(null);
      setHeaderImagePreview(null);
      setShowPreview(false);
      onClose();
    } catch (error) {
      console.error('Error sending template:', error);
      setError(error instanceof Error ? error.message : t('failed_send_media'));
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    setSelectedTemplate(null);
    setVariables({
      header: {},
      body: {},
      footer: {}
    });
    setHeaderImageFile(null);
    setHeaderImagePreview(null);
    setShowPreview(false);
    setSearchTerm('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-green-600" />
            <div>
              <h2 className="text-xl font-semibold">{t('send_template_title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('to_user', { name: selectedUser.custom_name || selectedUser.whatsapp_name || selectedUser.name })}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-full"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {!selectedTemplate ? (
            /* Template Selection */
            <div className="h-full flex flex-col">
              {/* Search */}
              <div className="p-6 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder={t('search_templates')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Templates List */}
              <div className="flex-1 overflow-y-auto p-6">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-green-600" />
                    <span className="ml-3 text-muted-foreground">{t('loading_templates')}</span>
                  </div>
                ) : error ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                      <p className="text-red-600 font-medium mb-2">{t('failed_load_templates')}</p>
                      <p className="text-sm text-muted-foreground mb-4">{error}</p>
                      <Button onClick={fetchTemplates} variant="outline" size="sm">
                        {t('try_again')}
                      </Button>
                    </div>
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchTerm ? t('no_templates_found') : t('no_approved_templates')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTemplates.map((template) => (
                      <div
                        key={template.id}
                        className="bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => handleTemplateSelect(template)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-medium text-sm">{template.name}</h3>
                            <p className="text-xs text-muted-foreground">{template.category}</p>
                          </div>
                          <span className="text-lg">{template.category_icon}</span>
                        </div>

                        <div className="text-xs text-muted-foreground mb-2">
                          {template.formatted_components.body?.text?.substring(0, 100)}
                          {template.formatted_components.body?.text && template.formatted_components.body.text.length > 100 ? '...' : ''}
                        </div>

                        <div className="flex items-center justify-between">
                          <span className={`text-xs px-2 py-1 rounded ${template.status_color}`}>
                            {template.status}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {extractVariables(template).all.length} variables
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Template Configuration */
            <div className="h-full flex">
              {/* Configuration Panel */}
              <div className={`${showPreview ? 'w-1/2' : 'w-full'} overflow-y-auto p-6 border-r border-border`}>
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">{selectedTemplate.name}</h3>
                      <p className="text-sm text-muted-foreground">{selectedTemplate.category}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTemplate(null)}
                    >
                      {t('back_to_templates')}
                    </Button>
                  </div>

                  {/* Header Image Upload — shown only for IMAGE-format templates */}
                  {hasImageHeader(selectedTemplate) && (
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <ImageIcon className="h-4 w-4 text-blue-500" />
                        <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                          {t('upload_header_image')}
                        </h4>
                        <span className="text-xs text-red-500 font-medium">*</span>
                      </div>

                      {!headerImagePreview ? (
                        <div
                          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                            isDraggingImage
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                              : 'border-border hover:border-blue-400 hover:bg-muted/50'
                          }`}
                          onDragOver={handleImageDragOver}
                          onDragLeave={handleImageDragLeave}
                          onDrop={handleImageDrop}
                          onClick={() => headerImageInputRef.current?.click()}
                        >
                          <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm font-medium mb-1">{t('header_image_required')}</p>
                          <p className="text-xs text-muted-foreground">{t('header_image_upload_hint')}</p>
                        </div>
                      ) : (
                        <div className="relative rounded-xl overflow-hidden border border-border">
                          <Image
                            src={headerImagePreview}
                            alt="Header image preview"
                            width={400}
                            height={200}
                            className="w-full object-cover max-h-40"
                            unoptimized
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => headerImageInputRef.current?.click()}
                              className="text-xs"
                            >
                              {t('header_image_change')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => { setHeaderImageFile(null); setHeaderImagePreview(null); }}
                              className="text-xs"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="px-3 py-2 bg-muted/80 flex items-center gap-2">
                            <ImageIcon className="h-3 w-3 text-green-600" />
                            <span className="text-xs text-muted-foreground truncate">
                              {t('header_image_selected')}: {headerImageFile?.name}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Hidden file input */}
                      <input
                        ref={headerImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        id="header-image-input"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleHeaderImageSelect(file);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  )}

                  {/* Variables */}
                  {extractVariables(selectedTemplate).all.length > 0 && (
                    <div className="space-y-6">
                      <h4 className="font-medium">{t('template_variables')}</h4>

                      {/* Header Variables */}
                      {extractVariables(selectedTemplate).header.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <h5 className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('header_variables')}</h5>
                          </div>
                          {extractVariables(selectedTemplate).header.map((variable) => (
                            <div key={`header-${variable}`}>
                              <Label htmlFor={`header-var-${variable}`}>
                                {t('header_variable_label', { var: variable })}
                              </Label>
                              <Input
                                id={`header-var-${variable}`}
                                value={variables.header[variable] || ''}
                                onChange={(e) => setVariables(prev => ({
                                  ...prev,
                                  header: { ...prev.header, [variable]: e.target.value }
                                }))}
                                placeholder={t('enter_header_value', { var: variable })}
                                className="mt-1"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Body Variables */}
                      {extractVariables(selectedTemplate).body.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <h5 className="text-sm font-medium text-green-700 dark:text-green-300">{t('body_variables')}</h5>
                          </div>
                          {extractVariables(selectedTemplate).body.map((variable) => (
                            <div key={`body-${variable}`}>
                              <Label htmlFor={`body-var-${variable}`}>
                                {t('body_variable_label', { var: variable })}
                              </Label>
                              <Input
                                id={`body-var-${variable}`}
                                value={variables.body[variable] || ''}
                                onChange={(e) => setVariables(prev => ({
                                  ...prev,
                                  body: { ...prev.body, [variable]: e.target.value }
                                }))}
                                placeholder={t('enter_body_value', { var: variable })}
                                className="mt-1"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Footer Variables */}
                      {extractVariables(selectedTemplate).footer.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                            <h5 className="text-sm font-medium text-purple-700 dark:text-purple-300">{t('footer_variables')}</h5>
                          </div>
                          {extractVariables(selectedTemplate).footer.map((variable) => (
                            <div key={`footer-${variable}`}>
                              <Label htmlFor={`footer-var-${variable}`}>
                                {t('footer_variable_label', { var: variable })}
                              </Label>
                              <Input
                                id={`footer-var-${variable}`}
                                value={variables.footer[variable] || ''}
                                onChange={(e) => setVariables(prev => ({
                                  ...prev,
                                  footer: { ...prev.footer, [variable]: e.target.value }
                                }))}
                                placeholder={t('enter_footer_value', { var: variable })}
                                className="mt-1"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error Message */}
                  {error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-medium text-red-800">{t('error_title')}</span>
                      </div>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Preview Panel */}
              {showPreview && (
                <div className="w-1/2 overflow-y-auto p-6">
                  <h4 className="font-medium mb-4">{t('preview_title')}</h4>
                  {renderTemplatePreview(selectedTemplate, variables)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedTemplate && (
          <div className="flex items-center justify-between p-6 border-t border-border bg-muted/50">
            <div className="text-sm text-muted-foreground">
              {t('template_details', { name: selectedTemplate.name, count: extractVariables(selectedTemplate).all.length })}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowPreview(!showPreview)}
                className="gap-2"
              >
                <Eye className="h-4 w-4" />
                {showPreview ? t('hide_preview') : t('show_preview')}
              </Button>
              <Button
                onClick={handleSendTemplate}
                disabled={isSending}
                className="bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('sending_message')}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {t('send_template_btn')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 