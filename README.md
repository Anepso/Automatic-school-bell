# School Bell — Aplikasi Bel Sekolah Otomatis

School Bell adalah aplikasi desktop untuk menjalankan bel sekolah secara otomatis berdasarkan jadwal yang telah ditentukan. Aplikasi ini dirancang untuk membantu sekolah mengelola jadwal bel dan pemutaran suara melalui satu aplikasi desktop yang praktis.

## Fitur Utama

- **Jadwal bel otomatis** — menjalankan pemutaran bel berdasarkan jadwal yang telah dikonfigurasi.
- **Manajemen jadwal** — menambahkan, mengubah, dan menghapus jadwal bel.
- **Impor jadwal Excel** — memudahkan pengisian jadwal melalui file spreadsheet.
- **Pengaturan hari** — mengelola jadwal untuk hari sekolah dan jadwal khusus yang didukung aplikasi.
- **Pengelolaan suara bel** — mengatur suara yang digunakan untuk pemutaran bel.
- **Identitas sekolah** — menampilkan identitas dan logo sekolah.
- **System tray** — menyediakan akses aplikasi melalui area notifikasi desktop.
- **Asisten AI** — mendukung bantuan berbasis AI untuk pekerjaan terkait jadwal, dengan konfigurasi layanan yang diperlukan.
- **Integrasi Windows** — menyediakan dukungan fitur desktop seperti pengaturan startup sesuai konfigurasi aplikasi.

## Teknologi

School Bell dikembangkan menggunakan teknologi berikut:

- [Electron](https://www.electronjs.org/) — aplikasi desktop.
- [React](https://react.dev/) — antarmuka pengguna.
- [Vite](https://vite.dev/) — proses pengembangan dan build antarmuka.
- [TypeScript](https://www.typescriptlang.org/) — pengembangan dengan tipe data.
- [Express](https://expressjs.com/) — backend aplikasi.
- [Google Gemini API](https://ai.google.dev/) — layanan AI untuk fitur asisten.

## Persyaratan Pengembangan

Sebelum menjalankan proyek, siapkan:

- Node.js versi 22 atau yang kompatibel dengan dependency proyek.
- [Bun](https://bun.sh/) untuk pengelolaan dependency berdasarkan `bun.lock`.
- Git.
- Sistem operasi desktop yang sesuai dengan kebutuhan pengembangan Electron.

## Memulai Pengembangan

### 1. Clone repository

```bash
git clone https://github.com/Anepso/Automatic-school-bell.git
cd Automatic-school-bell
```

### 2. Instal dependency

```bash
bun install --frozen-lockfile
```

### 3. Konfigurasi lingkungan

Jika menggunakan fitur yang memerlukan API key, siapkan file `.env` lokal berdasarkan `.env.example` dan isi konfigurasi yang diperlukan dengan kredensial milik Anda sendiri.

**Jangan mengunggah file `.env`, API key, atau kredensial pribadi ke GitHub.**

### 4. Jalankan aplikasi

Untuk menjalankan server pengembangan:

```bash
npm run dev
```

Untuk menjalankan aplikasi desktop dalam mode pengembangan:

```bash
npm run dev:desktop
```

Untuk membuat build aplikasi dan menjalankannya dalam mode produksi:

```bash
npm run desktop:production
```

## Pengujian dan Build

Beberapa perintah yang tersedia:

| Perintah | Fungsi |
|---|---|
| `npm run test:f03` | Menjalankan pengujian terkait autostart F-03 |
| `npm run test:f04` | Menjalankan pengujian terkait lifecycle F-04 |
| `npm run lint` | Memeriksa tipe TypeScript |
| `npm run build` | Membuat build frontend dan backend |
| `npm run build:linux` | Membuat paket Linux AppImage x64 |

Untuk proses packaging Windows x64, konfigurasi proyek menggunakan Electron Builder dengan target NSIS. Keberhasilan build aplikasi biasa tidak otomatis membuktikan bahwa installer Windows berhasil dipasang dan dijalankan pada komputer target.

## Status Proyek

Repository ini menjadi tempat pengembangan source code School Bell.

- Source code tersedia di GitHub.
- Pengujian otomatis dan pemeriksaan build telah dijalankan pada lingkungan pengembangan.
- Validasi akhir installer Windows masih menjadi pekerjaan lanjutan.
- Paket instalasi resmi akan diumumkan setelah proses packaging dan pengujian platform terkait selesai.

## Keamanan

- Simpan API key dan kredensial di lingkungan lokal.
- Jangan memasukkan file rahasia ke dalam commit.
- Gunakan `.env.example` sebagai referensi konfigurasi, bukan sebagai tempat menyimpan kredensial aktif.

## Lisensi

Proyek ini menggunakan lisensi **Proprietary**. Publikasi repository memungkinkan source code dilihat melalui GitHub, tetapi tidak dengan sendirinya memberikan izin untuk menggunakan kembali, mendistribusikan, atau memodifikasi kode di luar ketentuan pemilik proyek.

## Repository

Source code: https://github.com/Anepso/Automatic-school-bell

Dikembangkan oleh **Anep'so**.
