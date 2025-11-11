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
import { Playlist } from './types';

const SUPPORTED_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
];

const AUDIO_SOURCES: Record<string, string> = {
  en: '/Audio/Parratech English.mp3',
  zh: '/Audio/Parratech Chinese.mp3',
  ko: '/Audio/Parratech Korean.mp3',
};

const isYouTubeUrl = (url: string): boolean => /(?:youtu\.be\/|youtube\.com\/watch)/i.test(url);

const getYouTubeEmbedUrl = (url: string): string | null => {
  try {
    const shortUrlMatch = url.match(/youtu\.be\/([^?&#]+)/i);
    if (shortUrlMatch && shortUrlMatch[1]) {
      const videoId = shortUrlMatch[1];
      return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1&loop=1&playlist=${videoId}&mute=1`;
    }

    const urlObj = new URL(url);
    if (urlObj.hostname.toLowerCase().includes('youtube.com')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1&loop=1&playlist=${videoId}&mute=1`;
      }
    }
  } catch (error) {
    console.warn('Failed to derive YouTube embed URL', error);
  }
  return null;
};

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playMediaInSync = useCallback(
    async (resetTime = false) => {
      const video = videoRef.current;
      const audio = audioRef.current;
      if (!video || !audio) {
        return;
      }

      if (resetTime) {
        video.currentTime = 0;
        audio.currentTime = 0;
      }

      setSessionError(null);

      try {
        const playVideo = video.paused ? video.play() : Promise.resolve();
        const playAudio = audio.paused ? audio.play() : Promise.resolve();
        await Promise.all([playVideo, playAudio]);
      } catch (error) {
        console.error('Failed to start media playback', error);
        setSessionError('Unable to start playback automatically. Press play to continue.');
      }
    },
    [setSessionError]
  );

  const currentMedia = useMemo(() => {
    if (!playlist) {
      return { type: 'none' as const, url: '', embed: null };
    }
    const item = playlist.playlist[currentIndex];
    if (!item) {
      return { type: 'none' as const, url: '', embed: null };
    }
    if (isYouTubeUrl(item.src)) {
      return { type: 'youtube' as const, url: item.src, embed: getYouTubeEmbedUrl(item.src) };
    }
    return { type: 'video' as const, url: item.src, embed: null };
  }, [currentIndex, playlist]);

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

  const handleReplay = useCallback(() => {
    if (!playlist) return;
    const item = playlist.playlist[currentIndex];
    if (!item) return;

    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      video.currentTime = 0;
    }
    if (audio) {
      audio.currentTime = 0;
    }

    void playMediaInSync(true);
  }, [currentIndex, playMediaInSync, playlist]);

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

  const handleStart = useCallback(async () => {
    if (!playlist || isSessionActive || isStarting) return;
    const audioEl = audioRef.current;
    if (!audioEl) {
      setSessionError('Audio output is not ready. Please reload the page.');
      return;
    }

    setIsStarting(true);
    setSessionError(null);

    try {
      const audioSource = AUDIO_SOURCES[lang];
      if (!audioSource) {
        throw new Error('No audio source is available for the selected language.');
      }

      audioEl.src = audioSource;
      audioEl.preload = 'auto';
      audioEl.muted = false;
      audioEl.load();

      setIsSessionActive(true);
      setCurrentIndex(0);

      const video = videoRef.current;
      if (video) {
        video.currentTime = 0;
      }
      audioEl.currentTime = 0;

      await playMediaInSync(true);
    } catch (error) {
      console.error('Failed to start realtime session', error);
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  }, [isSessionActive, isStarting, lang, playMediaInSync, playlist]);

  const handleStop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }

    setIsSessionActive(false);
    setSessionError(null);
    setCurrentIndex(0);
    if (playlist) {
      const firstLine = playlist.playlist[0]?.line ?? '';
      setCurrentLine(firstLine);
    } else {
      setCurrentLine('');
    }
  }, [playlist]);

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
      if (currentMedia.type === 'video') {
        video.src = currentMedia.url;
        video.load();
        video.loop = true;
        video.autoplay = false;
        video.muted = true;
        video.playsInline = true;
        if (isSessionActive) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
          video.currentTime = 0;
        }
      } else {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }

    const audio = audioRef.current;
    if (audio) {
      if (!isSessionActive) {
        audio.pause();
        if (audio.readyState > 0) {
          audio.currentTime = 0;
        }
      } else {
        if (audio.readyState > 0) {
          audio.currentTime = 0;
        }
        audio.muted = false;
      }
    }

    if (isSessionActive) {
      const audioReady = audio ? audio.readyState > 0 : true;
      if (audioReady) {
        void playMediaInSync(true);
      }
    }
  }, [currentIndex, currentMedia, isSessionActive, playMediaInSync, playlist]);

  useEffect(() => {
    if (currentMedia.type !== 'video') return;
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
  }, [currentMedia, handleNext, isSessionActive]);

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
              Play the Parratech induction video with language-specific narration audio in perfect sync.
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
                  {currentMedia.type === 'youtube' && currentMedia.embed ? (
                    <iframe
                      key={currentMedia.embed}
                      src={currentMedia.embed}
                      title="Induction clip"
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      controls
                      className="h-full w-full bg-black"
                      poster=""
                      preload="metadata"
                      autoPlay
                      loop
                      muted
                      playsInline
                    >
                      Your browser does not support HTML5 video.
                    </video>
                  )}
                </div>
                {currentMedia.type !== 'none' && (
                  <div className="text-sm text-muted-foreground">
                    <a href={currentMedia.url} target="_blank" rel="noreferrer" className="underline">
                      Open this clip in a new tab
                    </a>
                  </div>
                )}
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
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <p>
              Use the controls above to restart the video or move between available sections. The selected narration
              track will stay perfectly in sync with the video playback.
            </p>
          </CardFooter>
        </Card>
        <audio ref={audioRef} className="hidden" preload="auto" />
      </div>
    </div>
  );
}

export default App;
