"""مفتاح توقيع ثابت لتطبيقات الأندرويد (الكاشير، الخط، الشاشة) — يتولد من سرّ GitHub واحد (SIGN_SEED).

نفس السرّ ← نفس المفتاح ونفس الشهادة بالضبط بكل بناء، فالنسخة الجديدة تنصب فوق القديمة
(بدون حذف، والتطبيق ما ينسى تسجيل الدخول)، والتطبيق يكدر يحدّث نفسه.
بدون السرّ: البناء يستخدم مفتاح مؤقت مثل قبل، والتحديث من داخل التطبيق يبقى مطفي.

الاستخدام (بالـ CI):  SIGN_SEED=... KEYSTORE_PASS=... python3 tools/signkey.py <out.p12>
يطبع بصمة الشهادة (SHA-256) — هي نفسها اللي التطبيق يقارنها قبل ما يحدّث نفسه.
"""
import datetime
import hashlib
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

E = 65537
MIN_SEED = 20


class Drbg:
    """أرقام «عشوائية» ثابتة من السرّ: SHA-256 بعدّاد فوق مفتاح scrypt (يصعّب تخمين السرّ)."""

    def __init__(self, seed: str):
        self.k = hashlib.scrypt(seed.encode('utf-8'), salt=b'sora3a-apk-signing-v1', n=2 ** 15, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
        self.n = 0

    def bytes(self, size: int) -> bytes:
        out = b''
        while len(out) < size:
            self.n += 1
            out += hashlib.sha256(self.k + self.n.to_bytes(8, 'big')).digest()
        return out[:size]

    def below(self, top: int) -> int:
        return int.from_bytes(self.bytes((top.bit_length() + 7) // 8 + 8), 'big') % top


SMALL = [p for p in range(3, 2000, 2) if all(p % d for d in range(3, int(p ** 0.5) + 1, 2))]


def is_prime(n: int, rnd: Drbg) -> bool:
    if any(n % p == 0 for p in SMALL):
        return n in SMALL
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(40):
        a = 2 + rnd.below(n - 3)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def prime(bits: int, rnd: Drbg) -> int:
    while True:
        c = int.from_bytes(rnd.bytes(bits // 8), 'big') | (3 << (bits - 2)) | 1   # أعلى بتّين = 1 حتى يطلع n بطول 2048 بالضبط
        if (c - 1) % E and is_prime(c, rnd):
            return c


def key_from_seed(seed: str) -> rsa.RSAPrivateKey:
    rnd = Drbg(seed)
    p = prime(1024, rnd)
    q = prime(1024, rnd)
    while q == p:
        q = prime(1024, rnd)
    if p < q:
        p, q = q, p
    n = p * q
    assert n.bit_length() == 2048
    d = pow(E, -1, (p - 1) * (q - 1))
    pub = rsa.RSAPublicNumbers(E, n)
    return rsa.RSAPrivateNumbers(p, q, d, d % (p - 1), d % (q - 1), pow(q, -1, p), pub).private_key()


def cert_for(key: rsa.RSAPrivateKey) -> x509.Certificate:
    # كل حقول الشهادة ثابتة (التاريخ والرقم التسلسلي) وتوقيع RSA PKCS#1 v1.5 ثابت ← نفس الشهادة بالبايت
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Sora3a'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Sora3a')])
    utc = datetime.timezone.utc
    return (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(datetime.datetime(2026, 1, 1, tzinfo=utc))
            .not_valid_after(datetime.datetime(2076, 1, 1, tzinfo=utc)).sign(key, hashes.SHA256()))


def main() -> None:
    seed, pw, out = os.environ.get('SIGN_SEED', ''), os.environ['KEYSTORE_PASS'].encode(), sys.argv[1]
    if len(seed.strip()) < MIN_SEED:
        sys.exit(f'SIGN_SEED لازم {MIN_SEED} حرف أو أكثر')
    key = key_from_seed(seed.strip())
    cert = cert_for(key)
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(pw))
    with open(out, 'wb') as f:
        f.write(pkcs12.serialize_key_and_certificates(b'sora3a', key, cert, None, enc))
    print(hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest())


if __name__ == '__main__':
    main()
