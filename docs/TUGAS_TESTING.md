# Pengumpulan Tugas

Aturan yang disepakati:

- Jika guru mengizinkan teks dan foto, siswa memilih salah satu: teks atau satu foto.
- Foto JPG, PNG, atau WebP maksimal 2 MB. File divalidasi lagi di server.
- Pengumpulan dan perubahan jawaban ditutup setelah tenggat. Guru dapat memperpanjang tenggat melalui Edit.
- Semua tanggal/jam Tugas menggunakan WITA. Nilai timestamp tenggat lama tidak digeser oleh migrasi.
- Jawaban yang sudah dinilai tetap terlihat, tetapi tidak dapat diubah siswa.
- Pengumpulan ulang mengganti jawaban dan waktu pengumpulan sebelumnya; tidak membuat riwayat versi baru.

## Migrasi dan rilis

Jalankan `supabase/migrations/20261015000000_protect_assignment_submissions.sql` melalui SQL Editor Supabase pada proyek yang benar, berdekatan dengan rilis kode baru dan saat pengumpulan tidak sedang digunakan.

Kode baru membutuhkan RPC dalam migrasi. Setelah migrasi, aplikasi lama yang masih menulis pengumpulan langsung akan ditolak. Karena itu, jangan membiarkan migrasi dan rilis kode terpisah lama; muat ulang tab aplikasi setelah rilis.

Migrasi tidak menambah tabel atau kolom aplikasi dan tidak menulis ulang jawaban, nilai, atau tenggat lama. Migrasi menambahkan fungsi/trigger perlindungan serta satu bucket Storage privat `assignment-submissions` pada tabel Storage yang sudah disediakan Supabase. Unggah dilakukan server; akses foto memakai tautan sementara yang dibuat setelah pemeriksaan hak akses.

Pengujian otomatis dijalankan di database PostgreSQL lokal sementara (PGlite) dan mock Supabase, bukan database produksi. File foto lama tidak dihapus otomatis oleh perubahan ini.

## Uji manual setelah migrasi dan rilis

1. Guru membuat tugas teks dengan tenggat beberapa menit ke depan. Pastikan waktu yang tampil sama dengan input WITA dan TP sesuai kelas/mapel.
2. Siswa mengirim teks. Pastikan muncul jawaban tersimpan, waktu pengumpulan terakhir, dan status menunggu penilaian. Muat ulang: hasil tetap terlihat.
3. Tekan Ubah Jawaban. Tanpa perubahan, tombol simpan nonaktif. Ubah lalu batalkan: jawaban lama tetap tersimpan. Ubah lalu simpan: hanya jawaban terakhir yang digunakan.
4. Buat tugas foto, lalu tugas yang mengizinkan teks dan foto. Pastikan tugas foto tidak menampilkan textarea dan pilihan keduanya tetap hanya mengirim satu metode. Uji dari handphone.
5. Pilih JPG/PNG/WebP di bawah 2 MB. Periksa pratinjau dan pengiriman. File terlalu besar atau tipe lain ditolak; foto valid sebelumnya tetap dipertahankan jika pilihan pengganti tidak valid.
6. Putuskan koneksi saat mencoba mengirim. Isian/pratinjau harus tetap tersedia. Jika respons terputus sesudah penyimpanan, muat ulang untuk memeriksa status sebelum mencoba lagi.
7. Setelah tenggat, pengiriman pertama maupun perubahan harus ditolak. Jawaban sebelumnya tetap dapat dibuka. Guru memperpanjang tenggat; muat ulang halaman siswa dan pastikan pengumpulan dibuka kembali.
8. Buka jawaban siswa di dua tab. Kirim perubahan dari tab pertama, kemudian dari tab kedua. Tab kedua harus diminta memuat ulang, bukan menimpa jawaban terbaru.
9. Guru membuka jawaban, lalu siswa mengirim perubahan sebelum guru menyimpan nilai. Penyimpanan nilai dari jawaban lama harus ditolak dan guru diminta membuka jawaban terbaru.
10. Guru menyimpan nilai dan komentar. Siswa memuat ulang: jawaban, nilai, dan komentar tetap tampil, tombol perubahan tidak tersedia. Memperpanjang tenggat tidak membuka jawaban yang sudah dinilai.
11. Gunakan filter Belum Mengumpulkan, Belum Dinilai, dan Sudah Dinilai pada pemeriksaan guru. Periksa foto dapat diperbesar dan jawaban tautan lama masih dapat dibuka.
12. Coba menghapus tugas kosong: berhasil. Coba menghapus tugas yang memiliki jawaban atau nilai: ditolak dan data siswa tetap ada.
13. Buat atau ganti lampiran guru, lalu simulasikan unggahan gagal. Tidak boleh muncul tugas baru tanpa lampiran akibat kegagalan upload; lampiran lama pada edit tidak hilang.
14. Nonaktifkan tugas dan periksa bahwa tugas disembunyikan. Gunakan tenggat untuk menutup pengumpulan tanpa menyembunyikan jawaban/nilai.

## Pemeriksaan lokal

```sh
node --test tests/security/*.test.mjs tests/ui/*.test.mjs
npm run typecheck
npm run build
npm run lint -- --ignore-pattern '.open-next/**'
```

`.open-next` berisi hasil build, sehingga dikecualikan dari lint sumber. Lint seluruh repositori masih memiliki masalah format lama pada `open-next.config.ts` (baris baru di akhir file); file konfigurasi tersebut tidak diubah untuk fitur Tugas.
