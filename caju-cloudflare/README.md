# Caju Clay

Caju Clay seramik atölyesinin web sitesi. Ziyaretçiler atölyeleri inceleyebilir ve randevu talebi gönderebilir. Atölye ekibi talepleri yönetim panelinden takip eder ve kontenjanı ziyaretçiye ayrıca teyit eder.

## Yerel çalıştırma

Node.js 24 gereklidir. Uygulama Node.js’in HTTP ve SQLite modüllerini kullanır.

```powershell
$env:ADMIN_PASSWORD = Read-Host 'Yönetici parolası' -MaskInput
npm.cmd start
```

- Site [localhost:3000](http://localhost:3000) adresinde açılır.
- Yönetim paneli [localhost:3000/admin](http://localhost:3000/admin) adresindedir. İlk kurulumda varsayılan kullanıcı adı `admin` ve parola `ADMIN_PASSWORD` değeridir. İlk kullanıcı adını `ADMIN_USER` ile belirleyebilirsiniz.
Daha önce yerel kurulumda oluşturulmuş bir `.env.local` dosyası varsa sunucuyu `node --env-file=.env.local server.js` komutuyla tekrar başlatabilirsiniz. Hesap ilk çalıştırmada SQLite’a kaydedilir. Panelden yaptığınız hesap değişiklikleri sonraki başlatmalarda geçerlidir.

SQLite dosyası ilk çalıştırmada `data/caju.sqlite` altında oluşturulur. Test kayıtları ve yönetici parolası GitHub deposuna eklenmemelidir.

## Teknik akış

| İşlem | Arayüz | Sunucu |
| --- | --- | --- |
| Ekleme | İletişim sayfasındaki randevu formu | `POST /randevu` |
| Listeleme | Yönetim panelindeki Randevular sekmesi | `GET /admin/randevular` |
| Güncelleme | Talep durumunu kaydetme | `POST /admin/bookings/:id/status` |
| Silme | Silme menüsünden kalıcı silme | `POST /admin/bookings/:id/delete` |

Sunucu, form alanlarını kontrol eder ve geçerli talepleri parametreli bir SQLite sorgusuyla kaydeder. Geçersiz gönderimde form değerleri gösterilmeye devam eder. Panel, kullanıcı adı ve parola ister. Durum değiştirme ve silme formları oturum dışından gönderilen istekleri engellemek için bir güvenlik belirteci kullanır.

İletişim sayfasındaki mesaj formu `POST /mesaj` üzerinden SQLite’a kaydedilir. Gönderici bilgileri, konu ve mesaj yönetim panelindeki **Mesajlar** sekmesinde görünür.

**Mesajlar** bölümünde metinle arama yapabilir, konuya ve okunma durumuna göre filtreleyebilir, mesajları okundu veya okunmadı olarak işaretleyebilirsiniz. **Randevular** bölümünde isim, iletişim bilgisi veya notla arama yapabilir, atölye ve talep durumuna göre filtreleyebilirsiniz.

## Yazı ve blok yönetimi

- **Yazılar → Yeni Yazı Ekle** üzerinden bir yazı başlığı girin. Başlık, paragraf ve alıntı blokları ekleyebilir, sıralarını değiştirebilir ve kaldırabilirsiniz.
- **Taslağı Kaydet** değişiklikleri panelde saklar. **Kaydet ve Yayınla** yeni sürümü ana sayfadaki **Atölyeden Yazılar** bölümünde gösterir.
- **Düzenle** ile yayındaki bir yazıyı taslak olarak değiştirebilirsiniz. Ana sayfada son yayınlanan sürüm görünür. Paneldeki **Yayınla** düğmesi kayıtlı taslağı yayına alır.
- **Sil** işlemi yazıyı ve yayınlanan sürümünü kaldırır. Yazılar ve randevular aynı SQLite dosyasında saklanır.

## Hesap ve site ayarları

- **Hesabım** bölümünden mevcut parolanızı doğrulayarak kullanıcı adınızı, parolanızı veya ikisini değiştirebilirsiniz. Yeni parola en az 16 karakter olmalıdır. Kaydettikten sonra tüm açık yönetici oturumları kapanır.
- **Site Ayarları** bölümünden ana sayfanın duyurusunu, başlığını ve açıklamasını düzenleyebilirsiniz. Duyuruyu kaldırmak veya varsayılan ana sayfa metinlerine dönmek için ilgili alanı boş bırakıp kaydedin.

## Cloudflare Workers + D1 dağıtımı

1. `caju-cloudflare.zip` dosyasını açın. `wrangler.jsonc` dosyasında `d1_databases` altındaki `00000000-0000-0000-0000-000000000000` değerini Cloudflare panelindeki **D1 SQL Database → caju-clay → Database ID** ile değiştirin. Bağlantı adı `DB` olarak kalmalıdır.
2. Düzenlediğiniz dosyayla birlikte ZIP içindeki proje dosyalarını GitHub deponuzun köküne yükleyin. Cloudflare’de **Workers & Pages** bölümünden bu depoyu bağlayın. Proje adı `caju`, **Build command** boş, **Deploy command** `npx wrangler deploy` olsun. Wrangler, statik dosyaları hazırlayan komutu yapılandırmadan çalıştırır.
3. Worker’ın **Settings → Variables and Secrets** bölümüne iki **Secret** ekleyin. Terminalde her değer için aşağıdaki komutu ayrı ayrı çalıştırarak iki farklı gizli değer üretebilirsiniz.

   ```powershell
   node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

   - **`ADMIN_PASSWORD`** ilk girişte kullanacağınız parola. Komutun ürettiği rastgele parolayı güvenli bir yerde saklayın.
   - **`ADMIN_PASSWORD_PEPPER`** ayrı bir 64 karakterli gizli değer. Yönetici parolasının doğrulanmasında kullanılır ve ilk kurulumdan sonra aynı kalmalıdır.

4. Secret’ları kaydedin ve güncel Worker sürümünü dağıtın. İlk açılışta uygulama D1 tablolarını ve `admin` hesabını oluşturur. Cloudflare’in verdiği `workers.dev` adresinin sonuna `/admin/login` ekleyip giriş yapın. Ardından bir deneme mesajı ve randevu gönderip panelde kontrol edin.

Worker doğrudan `DB` bağlantısını kullanır. D1 API belirteci gerekmez. Worker sürümünü daha önce Caju yönetici hesabı kurulmamış bir D1 veritabanıyla başlatın. Yerel ve Vercel yönetici parolalarının saklama biçimi farklıdır.

Yerel Worker denemesi için `.dev.vars.example` dosyasını `.dev.vars` olarak kopyalayın, iki Secret değerini doldurun ve `npx wrangler dev` çalıştırın. `.dev.vars` GitHub’a eklenmez. [Workers Git bağlantısı](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) · [D1 bağlantısı](https://developers.cloudflare.com/d1/get-started/) · [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## GitHub ve Vercel dağıtımı

1. `caju-vercel-d1.zip` dosyasını açın. İçindeki dosyaları GitHub deposunun köküne koyun. Mevcut canlı adresi korumak için Vercel’de **Settings → Git** bölümünde bağlı görünen depoyu ve üretim dalını kullanın. `api/index.js`, `public/.gitkeep` ve `vercel.json` dosyalarını da yükleyin. Aşağıdaki Git komutları yeni ve boş bir GitHub deposu içindir.

   ```powershell
   git init
   git add .
   git commit -m "Caju Clay web projesi"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/DEPO.git
   git push -u origin main
   ```

2. Cloudflare panelinde **D1 SQL Database** ekranını açıp `caju-clay` adlı bir veritabanı oluşturun. Hesap kimliğini (**Account ID**) ve veritabanı ayrıntılarındaki **Database ID** değerini alın. **API Tokens → Create Token → Create Custom Token** üzerinden ilgili hesapla sınırlı **Account → D1 → Edit** izni olan bir belirteç oluşturun. Kod tabloları ilk çalıştırmada oluşturur. Yerel SQLite kayıtları canlı veritabanına kendiliğinden aktarılmaz. [D1 başlangıç](https://developers.cloudflare.com/d1/get-started/) · [Cloudflare API belirteci](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
3. Vercel’de mevcut Caju projesini açın. Yeni bir proje kuruyorsanız **Add New → Project** üzerinden GitHub deposunu içe aktarın. Proje kökü depo kökü, Framework Preset **Other**, Node.js sürümü **24.x** olmalıdır. Build Command ve Output Directory panelindeki elle girilmiş ayarları kaldırın. Çıktı klasörü ve sunucu yönlendirmeleri `vercel.json` üzerinden uygulanır.
4. Aşağıdaki değişkenleri **Settings → Environment Variables** bölümünde **Production** kapsamına ekleyin. Ardından güncel GitHub commit’ini içeren **Production** dağıtımını başlatın. Canlı ve önizleme dağıtımlarını kullanacaksanız farklı veritabanları ve farklı erişim belirteçleri tanımlayın.

| Değişken | Değer |
| --- | --- |
| `D1_ACCOUNT_ID` | Cloudflare hesap kimliği |
| `D1_DATABASE_ID` | D1 veritabanı kimliği |
| `D1_API_TOKEN` | D1 yazma izni olan Cloudflare API belirteci |
| `ADMIN_PASSWORD` | İlk hesap kurulumu için en az 16 karakterli benzersiz parola. |
| `ADMIN_USER` | İlk hesap kurulumu için isteğe bağlı yönetici kullanıcı adı |
| `PUBLIC_ORIGIN` | İsteğe bağlı sabit HTTPS adresi. Belirli bir alan adıyla form gönderimini sınırlandırmak için yalnızca ilgili Vercel ortamına ekleyin. |

Yerel sunucu varsayılan olarak yalnızca `127.0.0.1` üzerinden dinler. Vercel’de formlar, yazılar, site ayarları ve yönetici oturumları D1’de saklanır. D1 değişkenleri girildiğinde uygulama bu bağlantıyı kullanır. Form ve giriş denemelerine uygulanan sayaçlar Vercel işlevinin her örneğinde ayrı çalışır. `.env.example` değişken adlarını gösterir. Gerçek değerleri GitHub’a eklemeyin.

Dağıtımdan sonra [canlı giriş ekranını](https://caju-pied.vercel.app/admin/login) açın. Bir deneme randevusu oluşturun, yönetim panelinde durumunu değiştirin ve silin. Canlı URL’yi ve öğretim elemanının erişebildiği GitHub depo adresini teslim edin. Yönetici parolası ve gerçek randevu verileri özel kalmalıdır.

Dağıtım belgeleri için [Vercel Node.js](https://vercel.com/docs/functions/runtimes/node-js), [D1 ücretsiz planı](https://developers.cloudflare.com/d1/platform/pricing/) ve [D1 Query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

### Canlı yönetici girişi açılmıyorsa

Vercel’de **Logs** sayfasını açıp canlı sitede `/admin/login` adresini yenileyin. Bu isteğe ait hata satırını kontrol edin.

- `D1_CONFIG_MISSING` için **Settings → Environment Variables** bölümünde üç D1 değişkeninin de **Production** kapsamında olduğunu kontrol edin.
- `D1_ID_INVALID` için hesap kimliği ile veritabanı kimliğini ilgili alanlara yeniden kopyalayın.
- `D1_HTTP_401`, `D1_HTTP_403` veya bir D1 API yetki hatası için belirtecin doğru hesaba ait olduğunu ve **D1 Edit** izni bulunduğunu kontrol edin.
- `ADMIN_BOOTSTRAP_REQUIRED` için **Production** kapsamında en az 16 karakterlik `ADMIN_PASSWORD` ekleyin.

Ortam değişkenlerini güncelledikten sonra Production dağıtımını yeniden başlatın. Destek isterken hata kodunu paylaşın. Parola ve erişim belirtecini paylaşmayın.

## Sunum akışı

1. **45 saniye** — Caju Clay’i ve atölye randevularına ilişkin mevcut süreci tanıtın.
2. **1 dakika** — Gerçek müşteri brief’ini ve görüşme kanıtını gösterin. Brief’teki talepleri arayüz kararlarıyla ilişkilendirin.
3. **2 dakika** — Canlı sitede deneme talebi oluşturun. Yönetim paneline girin, talebi listeleyin, durumunu değiştirin ve silin.
4. **1 dakika** — `server.js` üzerinden form doğrulamasını ve dört SQLite işlemini açıklayın.
5. **45 saniye** — Codex’i Node.js ve SQLite entegrasyonu, form doğrulaması ve yerel HTTP kontrollerinde nasıl kullandığınızı anlatın.
6. **30 saniye** — Talepleri ve durumlarını tek panelden izlemenin atölye ekibine sağladığı faydayı özetleyin.
