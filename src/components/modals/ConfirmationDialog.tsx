import React from 'react';

export interface ConfirmationDialogRequest {
  title: string;
  description: string;
  impact: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
}

interface ConfirmationDialogProps extends ConfirmationDialogRequest {
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  title,
  description,
  impact,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}) => (
  <div
    className="fixed inset-0 z-80 flex items-center justify-center bg-[#141b2b]/50 p-4 backdrop-blur-sm animate-fade-in"
    onClick={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') onCancel();
    }}
    tabIndex={-1}
  >
    <section
      aria-describedby="confirmation-description"
      aria-labelledby="confirmation-title"
      aria-modal="true"
      className="w-full max-w-110 rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl"
      role="dialog"
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone === 'danger' ? 'bg-rose-50 text-[#BA1A1A]' : 'bg-[#E9EDFF] text-[#3525CD]'}`}>
          <span className="material-symbols-outlined text-[24px]">
            {tone === 'danger' ? 'delete_sweep' : 'help'}
          </span>
        </div>
        <button
          aria-label="Tutup dialog konfirmasi"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5A5E69] transition-colors hover:bg-[#F1F3FF] hover:text-[#141b2b]"
          onClick={onCancel}
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <h2 className="mt-4 text-[18px] font-semibold text-[#141b2b]" id="confirmation-title">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[#5A5E69]" id="confirmation-description">
        {description}
      </p>

      <div className={`mt-4 flex items-start gap-2.5 rounded-lg border p-3 text-[12px] leading-relaxed ${tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-[#C7D2FE] bg-[#EEF2FF] text-[#3525CD]'}`}>
        <span className="material-symbols-outlined mt-0.5 text-[18px]">
          {tone === 'danger' ? 'warning' : 'info'}
        </span>
        <span>{impact}</span>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          autoFocus
          className="h-10 rounded-lg border border-[#E5E7EB] bg-white px-4 text-[13px] font-medium text-[#141b2b] transition-colors hover:bg-[#F1F3FF]"
          onClick={onCancel}
          type="button"
        >
          Batal
        </button>
        <button
          className={`h-10 rounded-lg px-4 text-[13px] font-semibold text-white transition-colors ${tone === 'danger' ? 'bg-[#BA1A1A] hover:bg-[#991B1B]' : 'bg-[#4F46E5] hover:bg-[#4338CA]'}`}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  </div>
);