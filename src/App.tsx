import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import { Button } from './components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Input } from './components/ui/input';
import { Progress } from './components/ui/progress';
import { Playlist, SessionInfo, TranscriptEntry } from './types';
import { createRealtimeClient, RealtimeClient } from './realtime';
import { parse, type CommandAction } from './commands';

const SUPPORTED_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English (Australia)' },
];

const createId = () =>
  typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
    ? (globalThis.crypto.randomUUID as () => string)()
    : Math.random().toString(36).slice(2);

const createEntry = (role: TranscriptEntry['role'], text: string): TranscriptEntry => ({
  id: createId(),
  role,
  text,
  timestamp: Date.now(),
});

function App() {
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialLang = searchParams.get('lang') || SUPPORTED_LANGUAGES[0]?.value || 'en';

  const [lang, setLang] = useState(initialLang);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [siteInput, setSiteInput] = useState('');
  const [siteTouched, setSiteTouched] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentLine, setCurrentLine] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const clientRef = useRef<RealtimeClient | null>(null);
  const clientListenerRef = useRef<EventListener | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSiteTouched(false);
  }, [lang]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('lang', lang);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [lang]);

  useEffect(() => {
    let active = true;
    setLoadingPlaylist(true);
    setPlaylistError(null);

    fetch(`/content/playlist.${lang}.json`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message =
            payload && typeof payload === 'object' && 'error' in payload
              ? String((payload as { error?: string }).error)
              : 'Unable to load playlist.';
          throw new Error(message || 'Unable to load playlist.');
        }
        return (await response.json()) as Playlist;
      })
      .then((data) => {
        if (!active) return;
        setPlaylist(data);
        setCurrentIndex(0);
        setCurrentLine(data.playlist[0]?.line ?? '');
        if (!siteTouched) {
          setSiteInput(data.site);
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load playlist', error);
        setPlaylist(null);
        setPlaylistError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!active) return;
        setLoadingPlaylist(false);
      });

    return () => {
      active = false;
    };
  }, [lang, siteTouched]);

  const appendTranscript = useCallback((role: TranscriptEntry['role'], text: string) => {
    setTranscripts((prev) => [...prev, createEntry(role, text)]);
  }, []);

  const handleReplay = useCallback(() => {
    if (!playlist) return;
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
    const item = playlist.playlist[currentIndex];
    if (item && isSessionActive && clientRef.current) {
      clientRef.current
        .speak(item.line)
        .catch((error) => console.error('Failed to replay line', error));
    }
  }, [currentIndex, isSessionActive, playlist]);

  const handleNext = useCallback(() => {
    if (!playlist) return;
    setCurrentIndex((prev) => {
      const next = Math.min(prev + 1, playlist.playlist.length - 1);
      return next === prev ? prev : next;
    });
  }, [playlist]);

  const handlePrev = useCallback(() => {
    if (!playlist) return;
    setCurrentIndex((prev) => {
      const next = Math.max(prev - 1, 0);
      return next === prev ? prev : next;
    });
  }, [playlist]);

  const handleShowById = useCallback(
    (id: string) => {
      if (!playlist) return;
      const index = playlist.playlist.findIndex((item) => item.id.toLowerCase() === id.toLowerCase());
      if (index === -1) {
        appendTranscript('system', `Clip ${id} is not part of the current playlist.`);
        return;
      }
      appendTranscript('system', `Switching to clip ${playlist.playlist[index].id}.`);
      setCurrentIndex(index);
    },
    [appendTranscript, playlist]
  );
  const handleCommand = useCallback(
    (command: CommandAction) => {
      if (!playlist || !isSessionActive) return;
      switch (command.action) {
        case 'NEXT': {
          if (currentIndex + 1 < playlist.playlist.length) {
            appendTranscript('system', 'Advancing to the next clip as requested.');
            handleNext();
          } else {
            appendTranscript('system', 'Already at the final clip.');
          }
          break;
        }
        case 'REPLAY': {
          appendTranscript('system', 'Replaying the current clip.');
          handleReplay();
          break;
        }
        case 'SHOW': {
          handleShowById(command.id);
          break;
        }
        default:
          break;
      }
    },
    [appendTranscript, currentIndex, handleNext, handleReplay, handleShowById, isSessionActive, playlist]
  );

  const handleStart = useCallback(async () => {
    if (!playlist || isSessionActive || isStarting) return;
    const site = siteInput || playlist.site;
    const audioEl = audioRef.current;
    if (!audioEl) {
      setSessionError('Audio output is not ready. Please reload the page.');
      return;
    }

    setIsStarting(true);
    setSessionError(null);

    try {
      const response = await fetch(`/session?lang=${encodeURIComponent(lang)}&site=${encodeURIComponent(site)}`);
      const payload = (await response.json()) as SessionInfo & { error?: string };
      if (!response.ok || (payload as { error?: string }).error) {
        throw new Error(payload.error || 'Failed to create realtime session.');
      }

      const client = await createRealtimeClient(payload, audioEl);
      const listener: EventListener = (event) => {
        const textEvent = event as CustomEvent<{ text: string }>;
        const text = textEvent.detail?.text ?? '';
        if (!text) return;
        appendTranscript('trainer', text);
        const command = parse(text);
        if (command) {
          handleCommand(command);
        }
      };

      client.addEventListener('text', listener);
      clientRef.current = client;
      clientListenerRef.current = listener;
      setTranscripts([createEntry('system', 'Session initialised. Ready to deliver the induction script.')]);
      setIsSessionActive(true);
      setCurrentIndex(0);
    } catch (error) {
      console.error('Failed to start realtime session', error);
      setSessionError(error instanceof Error ? error.message : String(error));
      if (clientRef.current) {
        if (clientListenerRef.current) {
          clientRef.current.removeEventListener('text', clientListenerRef.current);
          clientListenerRef.current = null;
        }
        clientRef.current.close();
        clientRef.current = null;
      }
    } finally {
      setIsStarting(false);
    }
  }, [appendTranscript, handleCommand, isSessionActive, isStarting, lang, playlist, siteInput]);

  const handleStop = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      if (clientListenerRef.current) {
        client.removeEventListener('text', clientListenerRef.current);
        clientListenerRef.current = null;
      }
      client.close();
      clientRef.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    setIsSessionActive(false);
    setTranscripts([]);
    setCurrentIndex(0);
    if (playlist) {
      const firstLine = playlist.playlist[0]?.line ?? '';
      setCurrentLine(firstLine);
    } else {
      setCurrentLine('');
    }
  }, [playlist]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        if (clientListenerRef.current) {
          clientRef.current.removeEventListener('text', clientListenerRef.current);
          clientListenerRef.current = null;
        }
        clientRef.current.close();
        clientRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!playlist) {
      setCurrentLine('');
      return;
    }
    const item = playlist.playlist[currentIndex];
    if (!item) return;
    setCurrentLine(item.line);

    const video = videoRef.current;
    if (video) {
      video.src = item.src;
      video.load();
      if (isSessionActive) {
        void video.play().catch(() => undefined);
      }
    }

    if (isSessionActive && clientRef.current) {
      clientRef.current
        .speak(item.line)
        .catch((error) => console.error('Failed to speak line', error));
    }
  }, [currentIndex, isSessionActive, playlist]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => {
      if (isSessionActive) {
        handleNext();
      }
    };

    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('ended', onEnded);
    };
  }, [handleNext, isSessionActive]);

  useEffect(() => {
    if (!playlist) return;
    const site = siteInput || playlist.site;
    document.title = `${site} Induction Player`;
  }, [playlist, siteInput]);

  const totalSteps = playlist?.playlist.length ?? 0;
  const progressValue = useMemo(() => {
    if (!playlist || totalSteps === 0) return 0;
    return ((currentIndex + 1) / totalSteps) * 100;
  }, [currentIndex, playlist, totalSteps]);

  const isFirstStep = currentIndex === 0;
  const isLastStep = playlist ? currentIndex >= playlist.playlist.length - 1 : true;

  return (
    <div className="bg-muted/30 py-10">
      <div className="container mx-auto max-w-6xl px-4">
        <Card>
          <CardHeader>
            <CardTitle>Parratech Site Induction Player</CardTitle>
            <CardDescription>
              Stream the induction videos while the AI trainer narrates each scripted line and responds to voice controls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="language">
                  Language
                </label>
                <Select value={lang} onValueChange={setLang} disabled={isSessionActive || isStarting}>
                  <SelectTrigger id="language">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((language) => (
                      <SelectItem key={language.value} value={language.value}>
                        {language.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium" htmlFor="site">
                  Site name
                </label>
                <Input
                  id="site"
                  value={siteInput}
                  onChange={(event) => {
                    setSiteTouched(true);
                    setSiteInput(event.target.value);
                  }}
                  placeholder="Enter the site name"
                  disabled={isSessionActive}
                />
              </div>
            </div>

            {playlistError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {playlistError}
              </div>
            )}

            {sessionError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {sessionError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleStart} disabled={!playlist || isSessionActive || isStarting || loadingPlaylist}>
                {isStarting ? 'Starting…' : 'Start Session'}
              </Button>
              <Button variant="secondary" onClick={handleStop} disabled={!isSessionActive}>
                Stop Session
              </Button>
              {loadingPlaylist && <span className="text-sm text-muted-foreground">Loading playlist…</span>}
            </div>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-4">
                <div className="aspect-video overflow-hidden rounded-lg border bg-black/90">
                  <video
                    ref={videoRef}
                    controls
                    className="h-full w-full bg-black"
                    poster=""
                    preload="metadata"
                  >
                    Your browser does not support HTML5 video.
                  </video>
                </div>
                <div className="rounded-lg border bg-card p-4 text-center text-xl font-semibold leading-relaxed shadow-sm min-h-[120px] flex items-center justify-center">
                  <span>{currentLine || 'Select a language and start the session to begin.'}</span>
                </div>
                <div className="space-y-2">
                  <Progress value={isSessionActive ? progressValue : 0} />
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Step {totalSteps > 0 ? currentIndex + 1 : 0} of {totalSteps}
                    </span>
                    <span>{playlist?.playlist[currentIndex]?.id ?? '--'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={handlePrev} disabled={!isSessionActive || isFirstStep}>
                    Previous
                  </Button>
                  <Button variant="outline" onClick={handleReplay} disabled={!isSessionActive}>
                    Replay
                  </Button>
                  <Button variant="outline" onClick={handleNext} disabled={!isSessionActive || isLastStep}>
                    Next
                  </Button>
                </div>
              </div>
              <div className="flex h-full flex-col rounded-lg border bg-card/80 p-4">
                <h3 className="text-lg font-semibold">Transcript</h3>
                <div className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-md bg-background/60 p-3 text-sm">
                  {transcripts.length === 0 && (
                    <p className="text-muted-foreground">The transcript will appear here once the session starts.</p>
                  )}
                  {transcripts.map((entry) => (
                    <div key={entry.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <span>{entry.role === 'trainer' ? 'Trainer' : 'System'}</span>
                        <span className="text-[10px] text-muted-foreground/80">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="rounded-md bg-muted/60 p-2 text-foreground">{entry.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <p>
              When the voice assistant says <code>[SHOW:NEXT]</code>, the next clip will begin immediately. Use <code>[REPLAY]</code> to restart the current clip or <code>[SHOW:ID]</code> to jump to a specific segment.
            </p>
          </CardFooter>
        </Card>
        <audio ref={audioRef} className="hidden" autoPlay />
      </div>
    </div>
  );
}

export default App;
