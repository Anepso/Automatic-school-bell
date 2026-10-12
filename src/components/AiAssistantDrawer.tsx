import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AiMessage, ScheduleItem, CategoryItem, AudioFileItem } from '../types';
import { playSoundByName, stopAudio } from '../utils/audioEngine';
import { normalizeAiProposal } from '../utils/aiSchedule';

interface AiAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySchedule: (categoryName: string, days: string[], items: ScheduleItem[]) => void;
  currentSchedules: ScheduleItem[];
  categories: CategoryItem[];
  audioFiles: AudioFileItem[];
  volume: number;
  schoolName: string;
}

/**
 * B6: client-side request budget. The server bound is 45s, so this must stay
 * above it for the server's own `AI_TIMEOUT` to be the one the admin sees;
 * it exists so the drawer can never be stranded in `isLoading` even if the
 * backend is unreachable in a way that never resolves the fetch.
 */
const AI_CLIENT_TIMEOUT_MS = 60_000;

/** Stable server error codes (`ai-assistant-endpoint.ts`). */
type AiErrorCode =
  | 'AI_BAD_REQUEST'
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'AI_INTERNAL_ERROR';

const AI_FALLBACK_MESSAGES: Record<AiErrorCode, string> = {
  AI_BAD_REQUEST: 'Permintaan tidak valid. Periksa kembali perintah yang dikirim.',
  AI_NOT_CONFIGURED:
    'Asisten AI belum dikonfigurasi di aplikasi ini. Hubungi administrator untuk mengaktifkan fitur AI.',
  AI_TIMEOUT: 'Asisten AI melebihi batas waktu. Coba lagi sebentar.',
  AI_RATE_LIMITED: 'Layanan AI sedang mencapai batas penggunaan. Coba lagi beberapa saat lagi.',
  AI_UNAVAILABLE: 'Asisten AI sedang tidak tersedia. Coba lagi beberapa saat lagi.',
  AI_INVALID_RESPONSE:
    'Respons AI tidak dapat digunakan. Silakan coba lagi dengan perintah yang lebih jelas.',
  AI_INTERNAL_ERROR: 'Terjadi kesalahan saat memproses permintaan AI.',
};

function isKnownAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && value in AI_FALLBACK_MESSAGES;
}

const INITIAL_MESSAGES: AiMessage[] = [
  {
    id: 'msg-1',
    role: 'assistant',
    text: 'Selamat datang di AI Assistant. Saya dapat membantu menyusun usulan jadwal bel, menganalisis bentrok waktu, atau menjawab pertanyaan tentang penjadwalan dan audio bel. Jadwal hanya tersimpan setelah Anda menekan "Terapkan & Simpan".',
    timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
  },
];

export const AiAssistantDrawer: React.FC<AiAssistantDrawerProps> = ({
  isOpen,
  onClose,
  onApplySchedule,
  currentSchedules,
  categories,
  audioFiles,
  volume,
  schoolName,
}) => {
  const [messages, setMessages] = useState<AiMessage[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [playingSound, setPlayingSound] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Never leave a request running (and `isLoading` stranded) after unmount.
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const pushAssistantMessage = useCallback(
    (partial: Omit<AiMessage, 'id' | 'role' | 'timestamp'> & { timestamp?: string }) => {
      const message: AiMessage = {
        id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        timestamp:
          partial.timestamp ||
          new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        ...partial,
      };
      if (!isMountedRef.current) return;
      setMessages((prev) => [...prev, message]);
    },
    []
  );

  const pushErrorMessage = useCallback(
    (code: AiErrorCode | null, detail?: string) => {
      const text = code ? AI_FALLBACK_MESSAGES[code] : AI_FALLBACK_MESSAGES.AI_UNAVAILABLE;
      pushAssistantMessage({
        text: `AI Assistant belum dapat menjawab: ${text}`,
        analysis: detail
          ? `${detail} Tidak ada jadwal yang diubah.`
          : 'Respons ini bukan hasil analisis AI. Tidak ada jadwal yang diubah.',
        scheduleAction: 'INFO',
      });
    },
    [pushAssistantMessage]
  );

  if (!isOpen) return null;

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputText).trim();
    // Duplicate submit stays blocked (B6 acceptance).
    if (!query || isLoading) return;

    const userMessage: AiMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      text: query,
      timestamp:
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
        ' • Admin',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), AI_CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: query,
          currentSchedules,
          categories: categories.map((c) => c.name),
          schoolName,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & { code?: unknown; message?: unknown })
        | null;

      if (!res.ok) {
        // Stable contract only: no raw upstream detail ever reaches the UI.
        const code = isKnownAiErrorCode(payload?.code) ? payload.code : null;
        pushErrorMessage(code);
        return;
      }

      const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
      if (!message || !payload) {
        // B6-GEM-07: a 200 without a usable message is not a success.
        pushErrorMessage('AI_INVALID_RESPONSE');
        return;
      }

      const AI_ACTIONS = ['CREATE', 'ANALYZE', 'MODIFY', 'INFO'] as const;
      const actionRaw =
        typeof payload.scheduleAction === 'string' ? payload.scheduleAction.toUpperCase() : '';
      const scheduleAction = (AI_ACTIONS as readonly string[]).includes(actionRaw)
        ? (actionRaw as AiMessage['scheduleAction'])
        : 'INFO';

      const applicableDays = Array.isArray(payload.applicableDays)
        ? payload.applicableDays.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
        : [];

      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const suggestedItems = rawItems.filter(
        (item): item is NonNullable<AiMessage['suggestedItems']>[number] =>
          typeof item === 'object' && item !== null
      );

      // A CREATE/MODIFY proposal with no usable items is not shown as a success.
      if ((scheduleAction === 'CREATE' || scheduleAction === 'MODIFY') && suggestedItems.length === 0) {
        pushErrorMessage('AI_INVALID_RESPONSE');
        return;
      }
      if (suggestedItems.length > 0 && applicableDays.length === 0) {
        pushErrorMessage('AI_INVALID_RESPONSE');
        return;
      }

      pushAssistantMessage({
        text: message,
        analysis: typeof payload.analysis === 'string' ? payload.analysis : '',
        scheduleAction,
        categoryName:
          typeof payload.categoryName === 'string' && payload.categoryName.trim()
            ? payload.categoryName.trim()
            : undefined,
        applicableDays: applicableDays.length > 0 ? applicableDays : undefined,
        suggestedItems: suggestedItems.length > 0 ? suggestedItems : undefined,
        applied: false,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        pushErrorMessage('AI_TIMEOUT');
      } else {
        pushErrorMessage(null);
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      // Always clears: success, error and timeout all land here.
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleApply = (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg || !msg.suggestedItems || msg.suggestedItems.length === 0) return;

    // B6: soundId is resolved from real application data and every applicable
    // day produces its own row. No hard-coded id, no silent day truncation.
    const normalized = normalizeAiProposal(
      {
        categoryName: msg.categoryName,
        applicableDays: msg.applicableDays || [],
        items: msg.suggestedItems,
      },
      { currentSchedules, audioFiles }
    );

    if (normalized.rows.length === 0) {
      pushAssistantMessage({
        text: 'Usulan jadwal tidak dapat diterapkan: tidak ada hari berlaku atau item yang valid.',
        analysis: 'Tidak ada jadwal yang diubah.',
        scheduleAction: 'INFO',
      });
      return;
    }

    const days = Array.from(new Set(normalized.rows.map((row) => row.day)));
    onApplySchedule(msg.categoryName || 'Jadwal AI', days, normalized.rows);

    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const notes: string[] = [];
        if (normalized.unresolvedSoundCount > 0) {
          notes.push(
            `${normalized.unresolvedSoundCount} bel belum terhubung ke file audio — pilih manual di menu Jadwal.`
          );
        }
        if (normalized.truncated) {
          notes.push('Sebagian baris tidak dapat dimuat karena batas jumlah baris.');
        }
        if (normalized.rejectedItemCount > 0) {
          notes.push(`${normalized.rejectedItemCount} item tidak valid dan dibuang.`);
        }
        return {
          ...m,
          applied: true,
          analysis: notes.length > 0 ? `${m.analysis ? `${m.analysis} ` : ''}${notes.join(' ')}` : m.analysis,
        };
      })
    );
  };

  const handlePlaySound = (soundName: string) => {
    if (playingSound === soundName) {
      stopAudio();
      setPlayingSound(null);
    } else {
      setPlayingSound(soundName);
      playSoundByName(soundName, volume).finally(() => {
        setPlayingSound(null);
      });
    }
  };

  return (
    <aside className="w-[500px] bg-white border-l border-slate-200/90 shadow-2xl flex flex-col h-full z-40 fixed top-10 right-0 bottom-10 select-none animate-slide-left">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-200 bg-white/95 backdrop-blur shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#4F46E5] text-white flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-slate-900 text-sm tracking-tight">AI Assistant</h3>
                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.2 rounded uppercase">
                  BETA v2.4
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Bantu kelola jadwal dan sistem bel sekolah</p>
            </div>
          </div>

          {/* Window / Drawer Controls */}
          <div className="flex items-center gap-1">
            <button
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              onClick={() => setMessages(INITIAL_MESSAGES)}
              title="Reset Percakapan"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
            <button
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              onClick={onClose}
              title="Tutup Drawer"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Connection Badge */}
        <div className="mt-2.5 flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200/80 rounded-md px-2.5 py-1 text-slate-600">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="font-medium text-slate-700">Terhubung ke School Bell Controller</span>
          </div>
          <span className="text-slate-400 font-mono text-[10px]">Latency: 18ms</span>
        </div>

        {/* Suggestion Action Chips */}
        <div className="mt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Pilihan Cepat
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className="px-2 py-1 text-left rounded bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-[11px] font-medium text-slate-600 transition truncate flex items-center gap-1"
              onClick={() => handleSendMessage('Buatkan jadwal bel khusus untuk Ujian Semester PAS (Penilaian Akhir Semester) mulai jam 07:15.')}
              type="button"
            >
              <span>📅</span> + Buat Jadwal Ujian
            </button>
            <button
              className="px-2 py-1 text-left rounded bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-[11px] font-medium text-slate-600 transition truncate flex items-center gap-1"
              onClick={() => handleSendMessage('Tolong cek apakah ada jadwal bel yang bentrok atau tumpang tindih waktu.')}
              type="button"
            >
              <span>🔍</span> Cek Bentrok Jadwal
            </button>
            <button
              className="px-2 py-1 text-left rounded bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-[11px] font-medium text-slate-600 transition truncate flex items-center gap-1"
              onClick={() => handleSendMessage('Bagaimana cara menduplikasi jadwal Senin ke hari Selasa, Rabu, dan Kamis?')}
              type="button"
            >
              <span>⚡</span> Duplikat Senin ke Jumat
            </button>
            <button
              className="px-2 py-1 text-left rounded bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 text-[11px] font-medium text-slate-600 transition truncate flex items-center gap-1"
              onClick={() => handleSendMessage('Sebutkan file audio bel apa saja yang tersedia untuk bel masuk dan istirahat.')}
              type="button"
            >
              <span>🔊</span> Cek Suara Bel
            </button>
          </div>
        </div>
      </div>

      {/* Chat Conversation Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs" ref={chatScrollRef}>
        {messages.map((msg, idx) => (
          <div className="space-y-3" key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex flex-col items-end">
                <div className="bg-[#4F46E5] text-white rounded-2xl rounded-tr-none px-3.5 py-2.5 max-w-[90%] shadow-sm leading-relaxed text-xs">
                  {msg.text}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 mr-1">{msg.timestamp}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {/* AI Analysis Bar */}
                <div className="p-2.5 bg-indigo-50/80 border border-indigo-100 rounded-xl flex items-start gap-2.5 text-indigo-900">
                  <div className="w-5 h-5 rounded-md bg-indigo-200/80 flex items-center justify-center shrink-0 text-indigo-700 mt-0.5">
                    <span className="material-symbols-outlined text-[16px]">bolt</span>
                  </div>
                  <div>
                    <div className="font-semibold text-[11px] text-indigo-950 flex items-center gap-1">
                      <span>Menghubungkan ke jadwal {schoolName}...</span>
                    </div>
                    <p className="text-[11px] text-indigo-700/90 mt-0.5">
                      {msg.analysis
                        ? `Analisis: ${msg.analysis}`
                        : 'Jadwal siap dikonfigurasi.'}
                    </p>
                  </div>
                </div>

                {/* If text message */}
                {msg.text && (
                  <p className="text-slate-700 text-xs leading-relaxed px-1">
                    {msg.text}
                  </p>
                )}

                {/* Generated Schedule Card Preview */}
                {msg.suggestedItems && msg.suggestedItems.length > 0 && (
                  <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
                    {/* Card Header */}
                    <div className="bg-slate-50/80 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-600 text-sm">📅</span>
                        <span className="font-bold text-slate-800 text-xs">
                          Jadwal Baru — {msg.categoryName || 'Khusus'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold">
                          {msg.applicableDays?.join(' & ') || 'Hari Khusus'}
                        </span>
                      </div>
                    </div>

                    {/* Generated Rows */}
                    <div className="divide-y divide-slate-100">
                      {msg.suggestedItems.map((item, itemIdx) => (
                        <div
                          className={`p-2.5 flex items-center justify-between hover:bg-slate-50 transition ${
                            item.name.toLowerCase().includes('istirahat') ? 'bg-amber-50/30' : ''
                          }`}
                          key={`sug-${itemIdx}`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`font-bold font-mono px-1.5 py-0.5 rounded text-[11px] ${
                                item.name.toLowerCase().includes('istirahat')
                                  ? 'text-amber-700 bg-amber-100'
                                  : item.name.toLowerCase().includes('pulang') || item.name.toLowerCase().includes('selesai')
                                  ? 'text-rose-700 bg-rose-50'
                                  : 'text-indigo-700 bg-indigo-50'
                              }`}
                            >
                              {item.time}
                            </span>
                            <div>
                              <div className="font-semibold text-slate-800 text-[11px]">
                                {item.name}
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                <span>{item.soundName}</span> • <span>Durasi {item.duration}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className={`w-6 h-6 rounded-full flex items-center justify-center transition cursor-pointer ${
                                playingSound === item.soundName
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-600'
                              }`}
                              onClick={() => handlePlaySound(item.soundName)}
                              title="Dengarkan Audio Bel"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {playingSound === item.soundName ? 'stop' : 'play_arrow'}
                              </span>
                            </button>
                            <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Aktif
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Bottom Actions inside Generated Card */}
                    <div className="p-3 bg-slate-50 border-t border-slate-200">
                      <div className="flex items-center gap-2 mb-2.5 text-[11px] text-slate-500">
                        <span className="material-symbols-outlined text-[16px] text-emerald-600">
                          verified_user
                        </span>
                        <span>
                          {msg.applied
                            ? '✓ Jadwal telah berhasil diterapkan ke sistem.'
                            : 'Safety Protocol: Jadwal ini belum aktif sampai disetujui.'}
                        </span>
                      </div>
                      {!msg.applied ? (
                        <div className="flex items-center gap-2">
                          <button
                            className="flex-1 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                            onClick={() => handleApply(idx)}
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[16px]">done</span>
                            <span>Terapkan & Simpan ke Jadwal</span>
                          </button>
                          <button
                            className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold py-2 px-3 rounded-lg text-xs transition cursor-pointer"
                            onClick={() => alert(`Rancangan jadwal "${msg.categoryName}" siap diedit di menu Jadwal.`)}
                            type="button"
                          >
                            Edit Detail
                          </button>
                          <button
                            className="bg-white hover:bg-rose-50 text-rose-600 border border-slate-200 font-semibold py-2 px-2.5 rounded-lg text-xs transition cursor-pointer"
                            onClick={() => {
                              setMessages((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            title="Batalkan Jadwal"
                            type="button"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          <span className="font-medium">Jadwal Tersimpan di Database Lokal</span>
                          <span className="font-semibold">Aktif</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="p-3 bg-indigo-50/70 rounded-xl flex items-center gap-3 text-indigo-700 text-xs">
            <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
            <span>AI sedang merancang dan menganalisis jadwal bel...</span>
          </div>
        )}
      </div>

      {/* Drawer Command Input Box */}
      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-100 transition shadow-inner">
          <textarea
            className="w-full text-xs p-2.5 pr-20 resize-none border-none focus:ring-0 placeholder:text-slate-400 bg-transparent text-slate-800 outline-none"
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Tulis perintah (contoh: Ubah istirahat jadi 45 menit atau buat jadwal ujian)..."
            rows={2}
            value={inputText}
          />
          {/* Action Buttons */}
          <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
            <button
              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-slate-100 transition cursor-pointer"
              onClick={() => {
                setInputText('Tolong analisis jadwal hari ini untuk mendeteksi potensi bentrok waktu.');
              }}
              title="Gunakan Templat Prompt Cepat"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">mic</span>
            </button>
            <button
              className="w-7 h-7 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg flex items-center justify-center transition shadow-xs cursor-pointer disabled:opacity-50"
              disabled={!inputText.trim() || isLoading}
              onClick={() => handleSendMessage()}
              title="Kirim Perintah"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
            </button>
          </div>
        </div>

        {/* B6: bounded request — the admin can always stop a pending request */}
        {isLoading && (
          <button
            className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-[10px] font-medium text-slate-500 hover:text-rose-600 bg-slate-50 border border-slate-200 rounded-md py-1 transition cursor-pointer"
            onClick={handleCancel}
            title="Batalkan permintaan AI"
            type="button"
          >
            <span className="material-symbols-outlined text-[13px]">stop_circle</span>
            Batalkan permintaan (maks {Math.round(AI_CLIENT_TIMEOUT_MS / 1000)} detik)
          </button>
        )}

        {/* Mode Protection Hint */}
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 px-1">
          <span>Tekan <b>Enter ↵</b> untuk mengirim</span>
          <span className="flex items-center gap-1 text-slate-500 font-medium">
            <span className="material-symbols-outlined text-[14px] text-indigo-600">verified_user</span>
            Mode Proteksi Admin Aktif
          </span>
        </div>
      </div>
    </aside>
  );
};
