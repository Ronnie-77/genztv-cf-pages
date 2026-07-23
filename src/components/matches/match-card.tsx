// v19 — Sport badge + bolder league/time, bigger flags, live elapsed timer, taller Watch Now button
'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { type Match } from '@/lib/api'
import { useCountdown } from '@/lib/hooks'
import { Clock, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MatchCardProps {
  match: Match
  variant?: 'live' | 'upcoming' | 'default'
}

function CountdownDisplay({ targetDate, label }: { targetDate: Date; label?: string }) {
  const { days, hours, mins, secs, started } = useCountdown(targetDate)

  if (started) {
    return <span className="text-[11px] text-red-500 font-bold animate-live-pulse">● LIVE</span>
  }

  const displayLabel = label || 'Starts in'

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] font-bold text-red-500">{displayLabel}</span>
      {days > 0 && <span className="text-[11px] font-extrabold text-red-500">{days}d</span>}
      <div className="flex items-center gap-0.5">
        {[hours, mins, secs].map((val, i) => (
          <span key={i} className="flex items-center">
            <span className="text-[12px] font-mono font-extrabold text-red-500 px-0.5">
              {String(val).padStart(2, '0')}
            </span>
            {i < 2 && <span className="text-[10px] text-red-500 font-bold mx-0.5">:</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// Live elapsed timer — counts UP from match.startTime so users can see
// how long a live match has been running. Updates every second.
// Format: MM:SS (under 1h) or H:MM:SS (1h+).
function LiveElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startMs = new Date(startTime).getTime()
    if (!Number.isFinite(startMs)) return
    const update = () => setElapsed(Math.max(0, Date.now() - startMs))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const totalSec = Math.floor(elapsed / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const formatted =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return (
    <span className="live-elapsed-timer" title="Match elapsed time">
      <span className="live-elapsed-dot" />
      <span className="live-elapsed-value">{formatted}</span>
    </span>
  )
}

function formatMatchTime(dateStr: string, timezone: string) {
  const date = new Date(dateStr)
  try {
    // Use Intl.DateTimeFormat to format in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    return formatter.format(date)
  } catch {
    // Fallback to local time
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[date.getMonth()]
    const day = date.getDate()
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const h = hours % 12 || 12
    const m = minutes < 10 ? `0${minutes}` : minutes
    return `${month} ${day}, ${h}:${m} ${ampm}`
  }
}

export function MatchCard({ match, variant }: MatchCardProps) {
  const { setCurrentPage, setCurrentChannelId, setCurrentMatchId, timezone } = useAppStore()
  // Check if an upcoming match has started (auto-transition to live)
  // Check if a live match has ended (auto-transition to ended)
  const baseStatus = variant || match.status || 'default'
  const { started: hasStarted } = useCountdown(new Date(match.startTime))
  const { started: hasEnded } = useCountdown(match.endTime ? new Date(match.endTime) : new Date('2099-12-31'))

  let status = baseStatus
  if (baseStatus === 'upcoming' && hasStarted) status = 'live'
  if ((status === 'live' || baseStatus === 'live') && match.endTime && hasEnded) status = 'ended'

  const handleWatch = () => {
    // Set both: currentChannelId holds the match id (watch.tsx reads it),
    // currentMatchId marks this as a match watch for analytics/live-viewer
    // attribution.
    setCurrentChannelId(match.id)
    setCurrentMatchId(match.id)
    setCurrentPage('watch')
  }

  const sportIcon = match.sport === 'cricket' ? '🏏' : match.sport === 'football' ? '⚽' : '🏆'
  const sportLabel =
    match.sport === 'cricket' ? 'Cricket' : match.sport === 'football' ? 'Football' : match.sport || 'Sports'
  const sportClass =
    match.sport === 'cricket' ? 'sport-cricket' : match.sport === 'football' ? 'sport-football' : 'sport-other'

  return (
    <div
      className={cn(
        'match-card group cursor-pointer relative overflow-hidden',
        status === 'live' && 'is-live',
        status === 'upcoming' && 'is-upcoming',
        status === 'ended' && 'is-ended',
        match.sport === 'football' && 'sport-football',
        match.sport === 'cricket' && 'sport-cricket',
      )}
      onClick={handleWatch}
    >
      {/* Decorative concentric circles - right side */}
      <div className="match-card-circles">
        <span className="match-card-circle-outer" />
        <span className="match-card-circle-inner" />
      </div>

      {/* Header: Sport badge + League name + Status */}
      <div className="match-card-header">
        <div className="match-league-wrap">
          <span className={cn('match-sport-badge', sportClass)}>
            <span className="match-sport-badge-icon">{sportIcon}</span>
            <span className="match-sport-badge-label">{sportLabel}</span>
          </span>
          {match.league && (
            <span className="match-league">{match.league}</span>
          )}
        </div>
        <div className="match-header-actions">
          <span
            className={cn(
              'match-status',
              status === 'live' && 'live',
              status === 'upcoming' && 'upcoming',
              status === 'ended' && 'ended',
            )}
          >
            {status === 'live' ? 'LIVE' : status === 'upcoming' ? 'UPCOMING' : 'ENDED'}
          </span>
        </div>
      </div>

      {/* Teams Section */}
      <div className="match-teams">
        {/* Team A */}
        <div className="match-team">
          <div className="team-logo">
            {match.teamALogo && match.teamALogo.startsWith('http') ? (
              <img
                src={match.teamALogo}
                alt={match.teamA}
                className="team-logo-img"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                  ;(e.target as HTMLImageElement).parentElement!.setAttribute('data-fallback', 'true')
                }}
              />
            ) : match.teamALogo ? (
              <span className="team-logo-emoji">{match.teamALogo}</span>
            ) : (
              <span className="team-logo-fallback">{match.teamA.charAt(0)}</span>
            )}
          </div>
          <span className="team-name">{match.teamA}</span>
        </div>

        {/* Center: VS or Score */}
        <div className="match-center">
          {status === 'live' ? (
            <span className="match-score">VS</span>
          ) : (
            <span className="match-vs">VS</span>
          )}
        </div>

        {/* Team B */}
        <div className="match-team">
          <div className="team-logo">
            {match.teamBLogo && match.teamBLogo.startsWith('http') ? (
              <img
                src={match.teamBLogo}
                alt={match.teamB}
                className="team-logo-img"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                  ;(e.target as HTMLImageElement).parentElement!.setAttribute('data-fallback', 'true')
                }}
              />
            ) : match.teamBLogo ? (
              <span className="team-logo-emoji">{match.teamBLogo}</span>
            ) : (
              <span className="team-logo-fallback">{match.teamB.charAt(0)}</span>
            )}
          </div>
          <span className="team-name">{match.teamB}</span>
        </div>
      </div>

      {/* Footer: Time + Timer + Actions */}
      <div className="match-footer">
        <div className="match-time inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-primary shrink-0" />
          <span>{formatMatchTime(match.startTime, timezone)}</span>
        </div>

        {baseStatus === 'upcoming' && !hasStarted && (
          <CountdownDisplay targetDate={new Date(match.startTime)} />
        )}

        {baseStatus === 'upcoming' && hasStarted && match.endTime && hasEnded && (
          <span className="text-[11px] text-muted-foreground">Match ended</span>
        )}

        {status === 'ended' && (
          <span className="text-[11px] text-muted-foreground">Match ended</span>
        )}

        {/* Live match: elapsed timer in CENTER + Watch Now on the right.
            The timer is a direct flex child of .match-footer (not wrapped
            with the button) so justify-content: space-between centers it
            between [match-time] and [watch-now-btn]. The timer's pulsing
            red dot already signals LIVE, so no separate ● LIVE badge is
            needed. (Task 27) */}
        {status === 'live' && (
          <>
            <LiveElapsedTimer startTime={match.startTime} />
            <button
              className="watch-now-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleWatch()
              }}
            >
              <Play className="h-3 w-3" fill="currentColor" /> Watch Now
            </button>
          </>
        )}

        {/* Upcoming→started auto-transition: same center-timer layout. */}
        {status === 'upcoming' && hasStarted && !hasEnded && (
          <>
            <LiveElapsedTimer startTime={match.startTime} />
            <button
              className="watch-now-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleWatch()
              }}
            >
              <Play className="h-3 w-3" fill="currentColor" /> Watch Now
            </button>
          </>
        )}

        {status === 'ended' && (
          <button
            className="watch-now-btn is-ended"
            onClick={(e) => {
              e.stopPropagation()
              handleWatch()
            }}
          >
            <RotateCcw className="h-3 w-3" /> Watch Replay
          </button>
        )}
      </div>
    </div>
  )
}
