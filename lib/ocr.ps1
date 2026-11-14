param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Out = '',
    [string]$Lang = 'zh-Hans-CN',
    # 数字被 OCR 读漏时，单独把那一小块放大再认一次：-Crop "x,y,w,h" -Scale 4
    [string]$Crop = '',
    [int]$Scale = 1
)

# Windows built-in OCR (WinRT) helper for "My Funds".
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File ocr.ps1 -Path shot.png -Out result.json
# Emits { lang, width, height, lines: [ { text, words: [ {t,x,y,w,h} ] } ] } as UTF-8 JSON.

$ErrorActionPreference = 'Stop'

function Write-Result([string]$json) {
    if ($Out) {
        [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
    }
    else {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::Out.Write($json)
    }
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
    [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]

    function Await($WinRtTask, $ResultType, $Step) {
        try {
            $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
            $netTask = $asTask.Invoke($null, @($WinRtTask))
            $netTask.Wait(-1) | Out-Null
            return $netTask.Result
        }
        catch {
            $e = $_.Exception
            while ($e.InnerException) { $e = $e.InnerException }
            throw "step=$Step : $($e.GetType().FullName): $($e.Message)"
        }
    }

    # StorageFile.GetFileFromPathAsync is blocked for desktop paths, so decode
    # from an in-memory stream built out of the raw bytes.
    # 先做可选的裁剪 + 放大（System.Drawing 在 Windows PowerShell 里可用）。
    if ($Crop) {
        Add-Type -AssemblyName System.Drawing | Out-Null
        $parts = $Crop -split ','
        $src = [System.Drawing.Image]::FromFile($Path)
        $x = [int]$parts[0]; $y = [int]$parts[1]; $w = [int]$parts[2]; $h = [int]$parts[3]
        $x = [math]::Max(0, $x); $y = [math]::Max(0, $y)
        $w = [math]::Min($w, $src.Width - $x); $h = [math]::Min($h, $src.Height - $y)
        $factor = [math]::Max(1, $Scale)
        $bmp = New-Object System.Drawing.Bitmap ([int]($w * $factor)), ([int]($h * $factor))
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $gfx.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, ([int]($w * $factor)), ([int]($h * $factor))), (New-Object System.Drawing.Rectangle $x, $y, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
        $tmpCrop = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("mf-crop-" + [guid]::NewGuid().ToString('N') + ".png"))
        $bmp.Save($tmpCrop, [System.Drawing.Imaging.ImageFormat]::Png)
        $gfx.Dispose(); $bmp.Dispose(); $src.Dispose()
        $Path = $tmpCrop
    }

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    Await ($writer.StoreAsync()) ([uint32]) 'store' | Out-Null
    $writer.DetachStream() | Out-Null
    $stream.Seek(0)

    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]) 'decoder'
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]) 'bitmap'

    if ($Lang -eq 'auto') {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    else {
        $language = New-Object Windows.Globalization.Language $Lang
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    }
    if ($null -eq $engine) { throw "no OCR engine for $Lang" }

    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) 'recognize'
    $stream.Dispose()

    $lines = New-Object System.Collections.ArrayList
    foreach ($line in $result.Lines) {
        $words = New-Object System.Collections.ArrayList
        foreach ($w in $line.Words) {
            [void]$words.Add([ordered]@{
                    t = $w.Text
                    x = [math]::Round($w.BoundingRect.X)
                    y = [math]::Round($w.BoundingRect.Y)
                    w = [math]::Round($w.BoundingRect.Width)
                    h = [math]::Round($w.BoundingRect.Height)
                })
        }
        [void]$lines.Add([ordered]@{ text = $line.Text; words = $words })
    }

    $payload = [ordered]@{
        ok     = $true
        lang   = $engine.RecognizerLanguage.LanguageTag
        width  = $bitmap.PixelWidth
        height = $bitmap.PixelHeight
        lines  = $lines
    }
    Write-Result (ConvertTo-Json -InputObject $payload -Depth 8 -Compress)
}
catch {
    $message = $_.Exception.Message
    Write-Result (ConvertTo-Json -InputObject ([ordered]@{ ok = $false; error = "$message" }) -Depth 4 -Compress)
    exit 1
}
