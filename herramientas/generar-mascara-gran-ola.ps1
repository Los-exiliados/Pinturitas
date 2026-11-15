# Genera la máscara de movimiento de "La gran ola de Kanagawa".
#
# Herramienta de build: NO la carga la aplicación. Se corre a mano cuando
# cambia la imagen o el criterio de la máscara, y reescribe
#     obras/la-gran-ola-mascara.png
#
# Uso:
#     powershell -ExecutionPolicy Bypass -File herramientas/generar-mascara-gran-ola.ps1
#
# Criterio:
#   - "Mar" = píxeles azul/cyan, o tinta oscura azulada.
#   - Se toma sólo el mar CONECTADO al borde inferior: una mota azul suelta
#     en el cielo no cuenta.
#   - Para cada columna se busca el primer píxel de agua real: todo lo que
#     queda debajo es región móvil (ola, espuma y barcos).
#   - El cielo, el Fuji, el cartucho y la firma quedan quietos.
#   - El borde se suaviza con tres pasadas de caja: el warping necesita un
#     degradado, no un corte a cuchillo.

Add-Type -AssemblyName System.Drawing

$raiz     = Split-Path -Parent $PSScriptRoot
$src      = Join-Path $raiz "obras/la-gran-ola-de-kanagawa.jpg"
$outMask  = Join-Path $raiz "obras/la-gran-ola-mascara.png"

$W = 400
if (-not (Test-Path $src)) {
  throw "No se encontró la imagen de la obra: $src"
}
$img = [System.Drawing.Image]::FromFile($src)
$H = [int][Math]::Round($img.Height * $W / $img.Width)

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, $W, $H)
$g.Dispose()
$img.Dispose()

$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$px = New-Object byte[] ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $px.Length)
$bmp.UnlockBits($data)
$bmp.Dispose()

# --- Zonas protegidas: cartucho, firma y Fuji ------------------------------
function EnProtegida($nx, $ny) {
  if ($nx -lt 0.17 -and $ny -lt 0.35) { return $true }   # cartucho
  if ($nx -lt 0.07 -and $ny -lt 0.36) { return $true }   # firma
  if ($ny -ge 0.60 -and $ny -le 0.716) {                 # Fuji (triángulo)
    $t = ($ny - 0.60) / 0.116
    $semiancho = 0.008 + 0.086 * $t
    if ([Math]::Abs($nx - 0.665) -le $semiancho) { return $true }
  }
  return $false
}

# Cascos: se fuerzan dentro del agua aunque su borde superior quede por
# encima de la línea, porque están EN el agua y se mueven con ella.
function EnBote($nx, $ny) {
  $botes = @(
    @(0.205, 0.675, 0.110, 0.058),   # bote de la ola, a la izquierda
    @(0.666, 0.742, 0.115, 0.030),   # bote junto al Fuji
    @(0.865, 0.745, 0.085, 0.045),   # popa del bote del borde derecho
    @(0.600, 0.848, 0.205, 0.055)    # bote grande inferior
  )
  foreach ($b in $botes) {
    $dx = ($nx - $b[0]) / $b[2]
    $dy = ($ny - $b[1]) / $b[3]
    if (($dx * $dx + $dy * $dy) -le 1.0) { return $true }
  }
  return $false
}

# --- Clasificación de "mar" -----------------------------------------------
$sea = New-Object 'bool[]' ($W * $H)
for ($y = 0; $y -lt $H; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $W; $x++) {
    $i = $row + $x * 4
    $b = [int]$px[$i]
    $gg = [int]$px[$i + 1]
    $r = [int]$px[$i + 2]
    $lum = 0.299 * $r + 0.587 * $gg + 0.114 * $b

    $esMar = (($b - $r) -gt 14) -or (($gg - $r) -gt 18 -and ($b -gt 70))
    if (($lum -lt 95) -and (($b - $r) -gt 6)) { $esMar = $true }
    if ($esMar) { $sea[$y * $W + $x] = $true }
  }
}

# --- Agua real: componentes grandes de mar -------------------------------
# El cuerpo de la gran ola puede estar separado del mar inferior por la
# espuma, así que no se exige conexión con el borde. Se descartan las
# manchas chicas (motas de tinta, espuma suelta) y se conservan las grandes:
# la ola, el mar bajo y las olas laterales.
$etiqueta = New-Object 'int[]' ($W * $H)
$areas = New-Object 'System.Collections.Generic.List[int]'
$cola = New-Object 'System.Collections.Generic.Queue[int]'
$siguiente = 1
$MIN_AREA = 150

for ($y0 = 0; $y0 -lt $H; $y0++) {
  for ($x0 = 0; $x0 -lt $W; $x0++) {
    $inicio = $y0 * $W + $x0
    if (-not $sea[$inicio] -or $etiqueta[$inicio] -ne 0) { continue }
    $cola.Clear()
    $etiqueta[$inicio] = $siguiente
    $cola.Enqueue($inicio)
    $area = 0
    while ($cola.Count -gt 0) {
      $idx = $cola.Dequeue()
      $area++
      $cx = $idx % $W
      $cy = [int][Math]::Floor($idx / $W)
      if ($cx -gt 0 -and $sea[$idx - 1] -and $etiqueta[$idx - 1] -eq 0) { $etiqueta[$idx - 1] = $siguiente; $cola.Enqueue($idx - 1) }
      if ($cx -lt ($W - 1) -and $sea[$idx + 1] -and $etiqueta[$idx + 1] -eq 0) { $etiqueta[$idx + 1] = $siguiente; $cola.Enqueue($idx + 1) }
      if ($cy -gt 0 -and $sea[$idx - $W] -and $etiqueta[$idx - $W] -eq 0) { $etiqueta[$idx - $W] = $siguiente; $cola.Enqueue($idx - $W) }
      if ($cy -lt ($H - 1) -and $sea[$idx + $W] -and $etiqueta[$idx + $W] -eq 0) { $etiqueta[$idx + $W] = $siguiente; $cola.Enqueue($idx + $W) }
    }
    $areas.Add($area)
    $siguiente++
  }
}

$agua = New-Object 'bool[]' ($W * $H)
for ($idx = 0; $idx -lt ($W * $H); $idx++) {
  $l = $etiqueta[$idx]
  if ($l -gt 0 -and $areas[$l - 1] -ge $MIN_AREA) { $agua[$idx] = $true }
}

# --- Línea de agua: primer píxel de agua real de cada columna -------------
$yAgua = New-Object 'int[]' $W
for ($x = 0; $x -lt $W; $x++) {
  $yAgua[$x] = $H
  $nx = $x / ($W - 1)
  for ($y = 0; $y -lt $H; $y++) {
    $ny = $y / ($H - 1)
    if (EnProtegida $nx $ny) { continue }
    if ($agua[$y * $W + $x]) { $yAgua[$x] = $y; break }
  }
}

$suave = New-Object 'double[]' $W
for ($x = 0; $x -lt $W; $x++) {
  $sum = 0.0; $n = 0
  for ($dx = -6; $dx -le 6; $dx++) {
    $xx = $x + $dx
    if ($xx -lt 0 -or $xx -ge $W) { continue }
    $sum += $yAgua[$xx]; $n++
  }
  $suave[$x] = $sum / $n
}

# La estela de espuma por encima de la cresta también es agua: la línea se
# sube un margen fijo. El cielo que entra en ese margen es plano, así que
# correrlo no se nota.
$MARGEN = $H * 0.13
$linea = New-Object 'double[]' $W
for ($x = 0; $x -lt $W; $x++) {
  $linea[$x] = [Math]::Max(0.0, $suave[$x] - $MARGEN)
}

# --- Máscara binaria -------------------------------------------------------
$peso = New-Object 'double[]' ($W * $H)
for ($y = 0; $y -lt $H; $y++) {
  $ny = $y / ($H - 1)
  for ($x = 0; $x -lt $W; $x++) {
    $nx = $x / ($W - 1)
    $v = 0.0
    if ($y -ge $linea[$x]) { $v = 1.0 }
    if (EnProtegida $nx $ny) { $v = 0.0 }
    if (EnBote $nx $ny) { $v = 1.0 }
    $peso[$y * $W + $x] = $v
  }
}

# --- Suavizado del borde ---------------------------------------------------
for ($pass = 0; $pass -lt 3; $pass++) {
  $next = New-Object 'double[]' ($W * $H)
  for ($y = 0; $y -lt $H; $y++) {
    for ($x = 0; $x -lt $W; $x++) {
      $sum = 0.0; $n = 0
      for ($dy = -3; $dy -le 3; $dy++) {
        $yy = $y + $dy
        if ($yy -lt 0 -or $yy -ge $H) { continue }
        for ($dx = -3; $dx -le 3; $dx++) {
          $xx = $x + $dx
          if ($xx -lt 0 -or $xx -ge $W) { continue }
          $sum += $peso[$yy * $W + $xx]; $n++
        }
      }
      $next[$y * $W + $x] = $sum / $n
    }
  }
  $peso = $next
}

# La protección se reaplica DESPUÉS del suavizado: el blur arrastra agua
# hacia adentro del Fuji y le movía la base. La silueta de la montaña es un
# corte duro; el agua pasa por detrás.
for ($y = 0; $y -lt $H; $y++) {
  $ny = $y / ($H - 1)
  for ($x = 0; $x -lt $W; $x++) {
    $nx = $x / ($W - 1)
    if (EnProtegida $nx $ny) { $peso[$y * $W + $x] = 0.0 }
  }
}

# --- Escritura de la máscara ----------------------------------------------
$mask = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$md = $mask.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$mstride = $md.Stride
$mb = New-Object byte[] ($mstride * $H)
for ($y = 0; $y -lt $H; $y++) {
  $row = $y * $mstride
  for ($x = 0; $x -lt $W; $x++) {
    $mv = $peso[$y * $W + $x]
    if ($mv -lt 0) { $mv = 0 }
    if ($mv -gt 1) { $mv = 1 }
    $v = [int][Math]::Round($mv * 255)
    $i = $row + $x * 3
    $mb[$i] = $v; $mb[$i + 1] = $v; $mb[$i + 2] = $v
  }
}
[System.Runtime.InteropServices.Marshal]::Copy($mb, 0, $md.Scan0, $mb.Length)
$mask.UnlockBits($md)
$mask.Save($outMask, [System.Drawing.Imaging.ImageFormat]::Png)
$mask.Dispose()

Write-Output "Máscara generada: $outMask (${W}x${H})"
