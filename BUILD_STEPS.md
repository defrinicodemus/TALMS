# Langkah Pembangunan Emerald Academy LMS (dari Nol)

Dokumen ini merangkum urutan langkah yang masuk akal untuk membangun ulang proyek LMS ini dari kosong sampai ke kondisinya saat ini. Urutannya disusun berdasarkan ketergantungan teknis yang logis (fondasi dulu, baru fitur, baru pengerasan keamanan, baru polish UI) — bukan urutan kronologis literal saat proyek ini dikerjakan, karena beberapa hal (audit keamanan, bersih-bersih migration) sebenarnya dilakukan belakangan setelah fitur-fitur inti berjalan.

## Fase 0 — Fondasi Proyek

- Setup Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, plus shadcn/ui (`components.json`, folder `src/components/ui/`).
- Setup proyek Supabase, simpan kredensial di `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Buat helper client Supabase: `src/lib/supabase/server.ts` (client biasa, tunduk RLS, dipakai di hampir semua Server Component/Action), `admin.ts` (service-role, bypass RLS — dipakai sangat selektif), `middleware.ts` (refresh session).
- Desain token dasar di `src/app/globals.css`: font (Fraunces untuk display, Plus Jakarta Sans untuk teks), palet warna, skala radius custom, shadow (`--shadow-soft`, `--shadow-glow`).

## Fase 1 — Skema Database & Autentikasi

- `schema.sql`: **cuma 11 tabel fondasi** — `schools`, `academic_years`, `subjects`, `classes`, `profiles` (dengan `role`, `class_id`, `nisn`/`nip`), `class_teacher_subjects`, `announcements`, `materials`, `assignments`, `submissions`, `grades` — plus enum `user_role` (`admin`/`teacher`/`student`/`principal`). **Belum semua tabel proyek** — tabel-tabel lain (kurikulum, bank soal kuis, jurnal presensi, dll) baru dibuat belakangan, masing-masing tepat saat fiturnya mulai dibangun (lihat catatan "tabel baru" di Fase 5/6/7/10 di bawah).
- `functions.sql`: fungsi bantu `security definer` yang jadi tulang punggung RLS — `current_role()`, `current_class_id()`, `is_admin()`, `is_principal()`, `teaches_class(class_id)` — plus trigger yang otomatis membuat baris `profiles` setiap kali ada `auth.users` baru.
- `rls.sql`: kebijakan RLS per tabel. Pola yang konsisten dipakai di seluruh proyek: guru/admin/kepsek lolos lewat fungsi bantu di atas, murid cuma lolos kalau `class_id` baris itu sama persis dengan `current_class_id()` miliknya sendiri.
- Login custom berbasis username (RPC `email_for_username`) karena murid SD lebih gampang diingat pakai NISN, bukan email asli.
- `middleware.ts` sengaja cuma memverifikasi status login (bukan role) — sesuai rekomendasi resmi Supabase untuk App Router, karena pengecekan role/object-level lebih tepat dilakukan di Server Component/Action masing-masing, bukan di middleware.

## Fase 2 — Bootstrap Akun Admin & Data Demo

Ini langkah yang gampang terlewat: akun admin **tidak pernah dibuat lewat UI aplikasi** — UI admin (Fase 4) justru baru bisa dipakai kalau admin sudah ada duluan, jadi ini masalah ayam-telur yang harus diselesaikan di level database, bukan aplikasi.

- `supabase/seed.sql` insert langsung ke `auth.users` + `auth.identities` (password di-hash pakai `crypt()`) untuk seluruh akun demo sekaligus: `admin`, `kepsek`, `guru` + 2 guru lain, dan 5 murid — masing-masing password-nya `username123`.
- Trigger dari Fase 1 otomatis mengisi tabel `profiles` dari `raw_user_meta_data` (role, username, nisn/nip, class_id) begitu baris `auth.users` dibuat — jadi cukup satu kali insert, tidak perlu menyentuh `profiles` secara manual.
- Seed yang sama juga mengisi data awal: sekolah, tahun ajaran, mata pelajaran, kelas, penugasan guru, beberapa materi/tugas/nilai contoh — supaya aplikasi langsung "hidup" begitu di-deploy, tidak kosong melompong.
- Setelah ini, admin pertama sudah bisa login dan mulai memakai UI Fase 4 untuk menambah akun-akun berikutnya secara normal.

## Fase 3 — Shell Aplikasi

- `(app)/layout.tsx`: bungkus semua halaman dengan `AuthProvider`, `SidebarProvider`, `AppSidebar`, `AppHeader`.
- Definisikan `NAV` per role di `AppSidebar.tsx` — daftar route resmi yang boleh diakses tiap role, dipakai juga sebagai referensi saat audit keamanan belakangan.
- `getCurrentUser()` (`src/lib/data/profile.ts`) jadi fondasi yang dipanggil di hampir setiap halaman/action untuk tahu siapa yang sedang login dan apa rolenya.

## Fase 4 — Modul Admin

- `users/`: CRUD akun murid/guru/kepala sekolah + reset password ke NISN/NIP default (satu-satunya tempat yang sah memakai `createAdminClient()` untuk operasi `auth.users`, selain seed).
- `academic/`: kelola tahun ajaran, kelas, mata pelajaran.
- `master-kelas/`: penempatan murid ke kelas dan guru ke kombinasi kelas+mapel.
- `settings/`: profil sekolah + upload logo (belakangan diperkaya dengan crop-tool, lihat Fase 13).

## Fase 5 — Modul Guru: Kurikulum & Konten

- **Tabel baru:** `curriculum_plans`, `learning_objectives`.
- `curriculum/`: susun Capaian Pembelajaran (CP) dan pecah jadi Tujuan Pembelajaran (TP) per kelas & mata pelajaran.
- `classroom/`: buat materi (pdf/video YouTube/teks kaya/gambar/slideshow Google Slides) dan tugas (jawaban teks/foto), masing-masing wajib terikat ke satu TP.

## Fase 6 — Modul Guru: Kuis & Penilaian

- **Tabel baru:** `quiz_questions`, `quiz_options` (dibangun bertahap), lalu `quiz_pairs` & `quiz_steps` saat tipe soal drag-and-drop/urutan ditambahkan, `quiz_answers`, dan `gradebook_locks`. `material_views` (pelacakan "sudah dibaca") juga masuk di rentang ini.
- Quiz builder dengan 4 tipe soal: pilihan ganda, benar-salah, drag-and-drop (pasangan), dan urutan langkah.
- `assessments/` ("Ruang Periksa"): koreksi tugas yang dikumpulkan murid secara manual, beri nilai + catatan motivasi.
- `gradebook/`: buku nilai akhir per kelas & mapel, dengan `gradebook_locks` supaya nilai yang sudah dihitung tidak berubah-ubah lagi tanpa dibuka kuncinya dulu.

## Fase 7 — Modul Guru: Presensi & Jurnal

- **Tabel baru:** `class_meetings`, `attendance_records`.
- `attendance/`: catat presensi per pertemuan sekaligus jurnal materi yang diajarkan hari itu.

## Fase 8 — Modul Murid

- `subjects/`: jelajahi materi/tugas/kuis per mata pelajaran, kerjakan dan kumpulkan langsung dari sana.
- `my-attendance/` dan `grades/`: lihat rekap presensi dan nilai milik sendiri.

## Fase 9 — Modul Kepala Sekolah (read-only)

- `teacher-monitoring/`, `students/`, `grades/` — seluruhnya read-only secara desain: fungsi `is_principal()` di RLS cuma pernah dipakai untuk kebijakan `select`, tidak pernah untuk `insert/update/delete`.

## Fase 10 — Fitur Lintas Peran

- `announcements/`: pengumuman sekolah dengan kategori, plus status "sudah dilihat" per user yang jadi dasar badge notifikasi di `AppHeader`.

## Fase 11 — Bersih-Bersih Migration

- 22 file migration Supabase dirapikan: gabungkan file yang sebenarnya satu fitur yang dipecah (split-feature), hapus objek yang dibuat lalu di-drop total di file lain tanpa pernah dipakai (net-zero — termasuk subsistem gamifikasi yang ternyata dead code), konsolidasikan RLS policy yang berkali-kali ditimpa ulang jadi cuma versi final di satu tempat. Skema kumulatif akhir dipastikan 100% identik sebelum dan sesudah — murni kerapian riwayat.

## Fase 12 — Audit & Perbaikan Keamanan (RBAC)

- Bangun helper terpusat `requireRole()` (untuk halaman, redirect kalau tidak lolos) dan `assertRole()` (untuk Server Action, return pesan error kalau tidak lolos) di `src/lib/auth/guard.ts`.
- Tutup celah paling kritis yang ditemukan: `users/actions.ts` yang tadinya memakai `createAdminClient()` di 8 fungsi mutasi tanpa satu pun pengecekan role — artinya siapa pun yang login (termasuk murid) bisa membuat/menghapus akun atau reset password siapa saja.
- Pasang guard yang sama secara sistematis di seluruh Server Action dan halaman, untuk keempat role (admin, guru, murid, kepala sekolah) — puluhan titik di banyak file.
- 4 temuan lanjutan didokumentasikan di `pengingat.md` untuk dikerjakan bertahap: validasi tipe/ukuran file upload (sudah dikerjakan sebagian, misalnya di `uploadSchoolLogo`), pesan error database yang masih bocor mentah ke client, rate limiting percobaan login, dan security headers (CSP dll). Idle timeout 30 menit sengaja **ditunda** menunggu diskusi terpisah.

## Fase 13 — Redesain UI Halaman Login

- Ubah frame logo sekolah jadi persegi dengan dukungan latar transparan (PNG/WEBP), supaya logo berbentuk non-kotak (mis. segi lima) tidak terpotong.
- Bangun tool crop-mask custom (tanpa dependency baru) saat admin upload logo baru — pakai kombinasi Radix Dialog + Slider + Canvas API yang sudah tersedia di proyek.
- Rombak layout jadi responsive penuh: desktop dikunci pas satu layar tanpa scroll, mobile disusun jadi dua kartu bertumpuk ala aplikasi native (logo di atas, form login menindih di bawahnya).
- Tambah modal "Lupa kata sandi", hapus tombol akun demo dari tampilan, tambah footer copyright, dan animasi fade-in/slide-up sekali saat pertama kali masuk ke dashboard setelah login berhasil (pakai utilitas `tw-animate-css` yang sudah ada, bukan CSS keyframes custom yang sempat gagal ter-compile).

## Fase 14 — Redesain Halaman Materi/Tugas/Kuis Murid

- Ubah tampilan daftar materi/tugas/kuis dari kumpulan kartu grid + modal pop-up menjadi daftar list-row dengan tombol "Lihat Detail" yang membuka halaman URL sendiri (bukan dialog) — lebih ramah untuk konten kaya (video, slideshow) dan lebih tahan terhadap refresh/back button.
- Beri setiap mata pelajaran URL sendiri (`/subjects/[subjectId]?tab=materi|tugas|kuis`) supaya tombol "Kembali" di halaman detail bisa mengarah tepat ke daftar & tab asalnya, bukan reset ke halaman pemilihan mata pelajaran.
- Verifikasi keamanan: dipastikan proteksi lintas-kelas/lintas-jenjang (mis. murid kelas 4 mencoba akses mapel kelas 6 lewat URL) sudah ditangani di level RLS database (`class_id = current_class_id()`), bukan cuma mengandalkan kode aplikasi.

## Catatan

Item yang masih tertunda per dokumen ini ditulis: **idle timeout 30 menit** (ditunda, menunggu diskusi terpisah) dan sisa 3 dari 4 temuan non-RBAC di `pengingat.md` (pesan error, rate limiting login, security headers) — lihat file itu untuk rencana detailnya.
