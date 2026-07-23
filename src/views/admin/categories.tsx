'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, FolderOpen, Edit, Trash2, X, Check, RefreshCw, GripVertical, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { fetchCategories, createCategory, updateCategory, deleteCategory, fetchChannels, type Category, type Channel } from '@/lib/api'
import { toast } from 'sonner'

const colorOptions = [
  { value: '#E8364E', label: '❤️ Dark Red' },
  { value: '#FF6766', label: '🔴 Coral' },
  { value: '#FFE3B3', label: '🟡 Peach' },
  { value: '#FF6B6B', label: '🩷 Salmon' },
  { value: '#FF69B4', label: '🩷 Pink' },
  { value: '#4ECDC4', label: '🟢 Teal' },
  { value: '#FF8C42', label: '🟠 Orange' },
  { value: '#A8E6CF', label: '💚 Mint' },
]

interface CategoryFormData {
  name: string
  icon: string
  color: string
  order: number
}

const emptyForm: CategoryFormData = {
  name: '',
  icon: '',
  color: '#FF6766',
  order: 0,
}

export function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CategoryFormData>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [cats, chs] = await Promise.all([
        fetchCategories(),
        fetchChannels({ includeInactive: true }),
      ])
      setCategories(cats)
      setChannels(chs)
    } catch {
      toast.error('Error', { description: 'Failed to load data' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getChannelCount = (categoryName: string) => {
    return channels.filter(ch => ch.category === categoryName.toLowerCase()).length
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Validation Error', { description: 'Category name is required' })
      return
    }

    setSaving(true)
    try {
      const data = {
        name: form.name,
        icon: form.icon,
        color: form.color,
        order: form.order,
        channelCount: editingId ? getChannelCount(form.name.toLowerCase()) : 0,
      }

      if (editingId) {
        await updateCategory(editingId, data)
        toast.success('Category Updated', { description: `${form.name} has been updated` })
      } else {
        await createCategory(data)
        toast.success('Category Created', { description: `${form.name} has been created` })
      }

      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      loadData()
    } catch {
      toast.error('Error', { description: 'Failed to save category' })
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (category: Category) => {
    setEditingId(category.id)
    setForm({
      name: category.name,
      icon: category.icon,
      color: category.color,
      order: category.order,
    })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory(id)
      toast.success('Category Deleted', { description: 'Category has been removed' })
      setDeleteConfirm(null)
      loadData()
    } catch {
      toast.error('Error', { description: 'Failed to delete category' })
    }
  }

  const handleReorder = async (category: Category, direction: 'up' | 'down') => {
    const currentIndex = categories.findIndex(c => c.id === category.id)
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (swapIndex < 0 || swapIndex >= categories.length) return

    const swapCategory = categories[swapIndex]
    try {
      await Promise.all([
        updateCategory(category.id, { order: swapCategory.order }),
        updateCategory(swapCategory.id, { order: category.order }),
      ])
      toast.success('Order Updated', { description: 'Category order has been updated' })
      loadData()
    } catch {
      toast.error('Error', { description: 'Failed to reorder categories' })
    }
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="gap-1.5 btn-press h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              setForm({ ...emptyForm, order: categories.length + 1 })
              setShowForm(!showForm)
            }}
            className="gap-1.5 btn-press text-xs h-9"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Category
          </Button>
        </div>
      </div>

      {/* Add/Edit Category Form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4 animate-fade-slide">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editingId ? 'Edit Category' : 'Add New Category'}</h3>
            <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Category Name *</label>
              <Input
                placeholder="e.g. Sports"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Icon (Emoji)</label>
              <div className="flex gap-2">
                <div className="w-9 h-9 rounded-lg border border-input bg-secondary flex items-center justify-center text-lg shrink-0">
                  {form.icon || '📁'}
                </div>
                <Input
                  placeholder="🏆"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  className="flex-1"
                  maxLength={4}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Color</label>
              <div className="flex gap-2 flex-wrap">
                {colorOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setForm({ ...form, color: opt.value })}
                    className={`w-8 h-8 rounded-full border-2 transition-all btn-press ${
                      form.color === opt.value ? 'border-foreground scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: opt.value }}
                    title={opt.label}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Display Order</label>
              <Input
                type="number"
                min={0}
                value={form.order}
                onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="bg-secondary/30 rounded-xl p-3">
            <p className="text-[10px] text-muted-foreground mb-2">Preview:</p>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                style={{ backgroundColor: `${form.color}20` }}
              >
                {form.icon || '📁'}
              </div>
              <div>
                <p className="font-medium text-sm">{form.name || 'Category Name'}</p>
                <p className="text-[10px] text-muted-foreground">Order: {form.order}</p>
              </div>
              <div
                className="w-3 h-3 rounded-full ml-auto"
                style={{ backgroundColor: form.color }}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="btn-press gap-1.5">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? 'Saving...' : editingId ? 'Update Category' : 'Create Category'}
            </Button>
          </div>
        </div>
      )}

      {/* Categories Grid */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading categories...</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold mb-1">No categories yet</h3>
          <p className="text-xs text-muted-foreground">Add your first category to organize channels.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category, index) => {
            const channelCount = getChannelCount(category.name)
            return (
              <div
                key={category.id}
                className="bg-card rounded-xl border border-border shadow-sm p-4 hover:shadow-md transition-shadow group"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: `${category.color}20` }}
                  >
                    {category.icon || '📁'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold truncate text-sm">{category.name}</h4>
                      <Badge variant="secondary" className="text-[10px] shrink-0 h-4 px-1.5">
                        {channelCount} ch{channelCount !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Order: {category.order}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="text-[10px] text-muted-foreground">{category.color}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleReorder(category, 'up')}
                      disabled={index === 0}
                      className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press disabled:opacity-30"
                      title="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleReorder(category, 'down')}
                      disabled={index === categories.length - 1}
                      className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press disabled:opacity-30"
                      title="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(category)}
                      className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press"
                      title="Edit"
                    >
                      <Edit className="h-3.5 w-3.5 text-primary" />
                    </button>
                    {deleteConfirm === category.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDelete(category.id)}
                          className="px-2 py-1 rounded-md bg-destructive text-destructive-foreground text-xs btn-press"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1 rounded-md bg-secondary text-xs btn-press"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(category.id)}
                        className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors btn-press"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
