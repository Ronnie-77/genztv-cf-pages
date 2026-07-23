import { db } from '@/lib/db'

/**
 * Creates an in-app bell notification automatically when a new channel is
 * added by the admin. This is fire-and-forget — if it fails, the channel
 * creation still succeeds (the caller wraps it in a try/catch).
 *
 * The notification is of type "channel" and links back to the channel via a
 * `#/channel/<id>` URL hash (the SPA router reads this).
 */
export async function createChannelNotification(channel: {
  id: string
  name: string
  logo?: string
  category?: string
}) {
  try {
    await db.appNotification.create({
      data: {
        type: 'channel',
        title: `New channel: ${channel.name}`,
        body: channel.category
          ? `Now streaming in ${channel.category}. Tap to watch.`
          : 'Tap to start watching.',
        url: `#/channel/${channel.id}`,
        imageUrl: channel.logo || '',
        isActive: true,
        sendPush: false, // Auto channel-notifications don't auto-push (admin can push manually if desired).
        pushSent: false,
      },
    })
  } catch (error) {
    // Never fail the channel creation because of a notification error.
    console.error('Failed to create channel notification:', error)
  }
}
