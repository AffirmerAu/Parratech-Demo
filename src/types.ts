export interface PlaylistItem {
  id: string;
  src: string;
  line: string;
}

export interface Playlist {
  site: string;
  locale: string;
  playlist: PlaylistItem[];
}

export interface TranscriptEntry {
  id: string;
  role: 'trainer' | 'system';
  text: string;
  timestamp: number;
}

export interface SessionInfo {
  client_secret: { value: string };
  model: string;
}
