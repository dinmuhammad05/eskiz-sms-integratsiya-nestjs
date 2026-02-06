# Eskiz SMS Integration Module (NestJS)

Ushbu modul **Eskiz.uz API** bilan ishlash uchun mo'ljallangan professional integratsiya yechimidir. Modul yuqori yuklamali (high-load) tizimlar uchun optimallashtirilgan bo'lib, avtomatik token menejmenti va xavfsiz retry mexanizmiga ega.

---

## Xususiyatlari

| Xususiyat | Tavsif |
|-----------|--------|
| **Auto Token Refresh** | JWT token muddati tugaganda (Expired), interceptor orqali avtomatik yangilanadi |
| **Race Condition Locking** | Bir vaqtning o'zida bir nechta so'rov 401 xatosi olsa, faqat 1 ta refresh so'rovi yuboriladi, qolgan so'rovlar navbatga (Queue) qo'yiladi |
| **Request Interception** | Har bir so'rovga Authorization headeri avtomatik qo'shiladi |
| **Deadlock Prevention** | `_retry` flagi yordamida cheksiz qayta urinishlarning oldi olingan |
| **Robust Error Handling** | API status kodlariga qarab (400, 422, 500+) aniq HttpException javoblari qaytariladi |

---

## Arxitektura

Modul **Axios Interceptors** va **Promise-based Queue** mantiqi asosida qurilgan.

### Ishlash prinsipi

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Request   │────▶│ 401 Handling│────▶│  Queueing   │────▶│  Broadcast  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
 Token tekshirish    isRefreshing        failedQueue       Yangi token bilan
 va qo'shish         holatiga o'tish     ga yig'ish        qayta yuborish
```

1. **Request** — So'rov yuborishdan oldin keshdagi token tekshiriladi
2. **401 Handling** — Agar server `Expired` xatosini qaytarsa, modul `isRefreshing` holatiga o'tadi
3. **Queueing** — Refresh jarayoni ketayotgan vaqtda kelgan barcha so'rovlar `failedQueue` massiviga yig'iladi
4. **Broadcast** — Token muvaffaqiyatli yangilangach, navbatdagi barcha so'rovlar yangi token bilan qayta yuboriladi

---

## O'rnatish va Sozlash

### 1. Environment sozlamalari

`.env` faylingizga Eskiz ma'lumotlarini qo'shing:

```env
ESKIZ_EMAIL=your_email@example.com
ESKIZ_PASSWORD=your_secure_password
```

### 2. Modulni import qilish

`SmsModule`ni kerakli joyda import qiling.

---

## Foydalanish

```typescript
import { SmsService } from './infrastructure/lib/sms.service';

@Injectable()
export class NotificationService {
  constructor(private readonly smsService: SmsService) {}

  async notifyUser(phone: string, code: string) {
    const message = `Sizning tasdiqlash kodingiz: ${code}`;
    await this.smsService.sendSms(phone, message);
  }
}
```

---

## Testlash

Modulning locking va refresh mantiqi **Jest** orqali to'liq qamrab olingan. Parallel so'rovlar oqimi simulyatsiya qilingan:

```bash
# Unit testlarni ishga tushirish
npm run test -- src/infrastructure/lib/sms.service.spec.ts
```

---

## Muhim eslatmalar

> **Rate Limiting:** Eskiz API login so'rovlari uchun limitga ega bo'lishi mumkin. Ushbu modulda locking mexanizmi aynan shu limitga tushib qolmaslikni kafolatlaydi.

> **Environment:** `appConfig` orqali barcha konfiguratsiyalar markazlashtirilgan holda boshqariladi.

---

## Muallif

**Dinmuhammad** — Full Stack Engineer

---

**Status:** Production Ready