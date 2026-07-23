'use client'

import * as React from 'react'
import { CalendarIcon, Clock } from 'lucide-react'
import { format } from 'date-fns'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

interface DateTimePickerProps {
  value: string // datetime-local format: "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  label?: string
  timeZoneLabel?: string // e.g. "BST (UTC+6)"
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  className,
  label,
  timeZoneLabel,
}: DateTimePickerProps) {
  // Parse the datetime-local value to a Date object
  const selectedDate = value ? new Date(value) : undefined

  // Extract time parts
  const hours = selectedDate ? selectedDate.getHours() : 0
  const minutes = selectedDate ? selectedDate.getMinutes() : 0

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return
    // Preserve existing time or default to current time
    const newDate = new Date(date)
    if (selectedDate) {
      newDate.setHours(selectedDate.getHours(), selectedDate.getMinutes())
    } else {
      const now = new Date()
      newDate.setHours(now.getHours(), now.getMinutes())
    }
    // Format as datetime-local value
    const formatted = formatDatetimeLocal(newDate)
    onChange(formatted)
  }



  const handleTimeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeVal = e.target.value
    if (!timeVal) return
    const [h, m] = timeVal.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return
    const base = selectedDate || new Date()
    base.setHours(h, m)
    onChange(formatDatetimeLocal(base))
  }

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
          {label}
          {timeZoneLabel && (
            <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">
              {timeZoneLabel}
            </span>
          )}
        </label>
      )}
      <div className="flex gap-2">
        {/* Date Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'flex-1 justify-start text-left font-normal h-9',
                !selectedDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-3.5 w-3.5" />
              {selectedDate ? format(selectedDate, 'MMM d, yyyy') : placeholder}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {/* Time Picker */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              type="time"
              value={`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`}
              onChange={handleTimeInput}
              className="h-9 w-[100px] pl-7 text-sm"
            />
          </div>
        </div>
      </div>
      {/* Quick time presets */}
      {selectedDate && (
        <div className="flex gap-1.5 flex-wrap">
          {[
            { label: 'Now', h: new Date().getHours(), m: new Date().getMinutes() },
            { label: '18:00', h: 18, m: 0 },
            { label: '19:00', h: 19, m: 0 },
            { label: '20:00', h: 20, m: 0 },
            { label: '21:00', h: 21, m: 0 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const base = new Date(selectedDate)
                base.setHours(preset.h, preset.m)
                onChange(formatDatetimeLocal(base))
              }}
              className="text-[10px] px-2 py-1 rounded-md bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors border border-border/50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Format a Date to datetime-local string: "YYYY-MM-DDTHH:mm" */
function formatDatetimeLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}
