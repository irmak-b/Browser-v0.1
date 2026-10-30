$ErrorActionPreference = 'Stop'
# Ephemeral fixture only. No certificate store or machine setting is modified.
$rsa = [Security.Cryptography.RSA]::Create(2048)
try {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $names = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddIpAddress([Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($names.Build())
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))
    try { [ordered]@{cert=$certificate.ExportCertificatePem();key=$rsa.ExportPkcs8PrivateKeyPem()} | ConvertTo-Json -Compress }
    finally { $certificate.Dispose() }
} finally { $rsa.Dispose() }
