import L from 'leaflet';

export interface HeatPoint {
  latitude: number;
  longitude: number;
  /** 0-1 arası normalize edilmiş yoğunluk. */
  intensity: number;
}

interface HeatOptions {
  /** Ekran pikseli cinsinden yarıçap. */
  radius: number;
  /** Bulanıklaştırma yarıçapı; yumuşak geçişi üretir. */
  blur: number;
  maxOpacity: number;
}

/**
 * Apple Photos tarzı bölgesel ısı haritası katmanı.
 *
 * Nasıl çalışır (klasik iki geçişli yaklaşım):
 *  1) Her nokta, gri tonlamalı bir radyal gradyan olarak çizilir ve
 *     üst üste binen noktalar `alpha` kanalında toplanır.
 *  2) Elde edilen alfa değeri bir 256 renklik palet üzerinde aranarak
 *     mor → mavi → camgöbeği → sarı → kırmızı geçişine dönüştürülür.
 *
 * Doğrudan renkli daire çizmek yerine bu yolun seçilmesinin nedeni:
 * renkli daireler üst üste bindiğinde renk bozulur; alfa toplayıp sonra
 * renklendirmek gerçek bir yoğunluk alanı üretir.
 */
export class HeatCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  // Leaflet'in kendi harita alanı özeldir ve tip tanımlarında güvenilir
  // biçimde yer almaz; haritayı kendimiz saklıyoruz.
  private map: L.Map | null = null;
  private points: HeatPoint[] = [];
  private readonly options: HeatOptions;
  private palette: Uint8ClampedArray | null = null;
  private frame: number | null = null;

  constructor(points: HeatPoint[], options: Partial<HeatOptions> = {}) {
    super();
    this.points = points;
    // Yumuşatılmış varsayılanlar: önceki değerler (34px yarıçap, %82
    // opaklık) çiğ ve göz yoran lekeler üretiyordu. Daha geniş ve daha
    // saydam bir dağılım altındaki haritayı okunur bırakır.
    this.options = { radius: 30, blur: 30, maxOpacity: 0.55, ...options };
  }

  override onAdd(map: L.Map): this {
    this.map = map;
    const canvas = L.DomUtil.create('canvas', 'leaflet-heat-layer') as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    // Pin'ler ısı katmanının üstünde kalmalı.
    canvas.style.zIndex = '200';
    canvas.style.transition = 'opacity 0.12s ease-out';

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const pane = map.getPane('overlayPane');
    pane?.appendChild(canvas);

    map.on('moveend zoomend resize', this.onMapSettled, this);
    // Zoom/kaydırma animasyonu boyunca katman gizlenir. Alternatifi,
    // Leaflet'in özel (underscore ile başlayan) yeniden izdüşüm API'lerine
    // dayanmaktır; bunlar sürümler arası kırılgandır. Gizle-ve-yeniden-çiz
    // hem tip güvenlidir hem de gözle görülür bir titreme üretmez.
    map.on('movestart zoomstart', this.hide, this);

    this.reset();
    return this;
  }

  override onRemove(map: L.Map): this {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    map.off('moveend zoomend resize', this.onMapSettled, this);
    map.off('movestart zoomstart', this.hide, this);
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.map = null;
    return this;
  }

  setPoints(points: HeatPoint[]): void {
    this.points = points;
    this.scheduleRedraw();
  }

  private hide = (): void => {
    if (this.canvas) this.canvas.style.opacity = '0';
  };

  private onMapSettled = (): void => {
    if (this.canvas) this.canvas.style.opacity = '1';
    this.scheduleRedraw();
  };

  private scheduleRedraw = (): void => {
    if (this.frame !== null) return;
    // Kaydırma sırasında her olayda yeniden çizmek yerine tek kare başına
    // bir çizim: büyük nokta kümelerinde akıcılığı korur.
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.reset();
    });
  };

  private reset(): void {
    const map = this.map;
    const canvas = this.canvas;
    if (!map || !canvas) return;

    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, size.x * dpr);
    canvas.height = Math.max(1, size.y * dpr);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setTransform(canvas, topLeft, 1);

    this.draw(dpr);
  }

  /** Gri tonlamalı tek nokta damgası (stamp). Her çizimde yeniden üretilmez. */
  private createStamp(radius: number, blur: number): HTMLCanvasElement {
    const stamp = document.createElement('canvas');
    const context = stamp.getContext('2d');
    const r = radius + blur;
    stamp.width = r * 2;
    stamp.height = r * 2;

    if (context) {
      const gradient = context.createRadialGradient(r, r, 0, r, r, r);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.45, 'rgba(0,0,0,0.55)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, r * 2, r * 2);
    }
    return stamp;
  }

  /** mor → mavi → camgöbeği → sarı → kırmızı geçişi (256 giriş). */
  private buildPalette(): Uint8ClampedArray {
    if (this.palette) return this.palette;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return new Uint8ClampedArray(1024);

    const gradient = context.createLinearGradient(0, 0, 256, 0);
    // Kurumsal yoğunluk skalası: koyu lacivert → kurumsal mavi → amber.
    // Önceki çiğ sarı-kırmızı skala "alarm" gibi okunuyordu; bu skala
    // yoğunluğu gösterirken haritanın altındaki coğrafyayı boğmaz.
    gradient.addColorStop(0.00, 'rgba(15, 32, 66, 0)');
    gradient.addColorStop(0.20, 'rgba(15, 32, 66, 0.55)');
    gradient.addColorStop(0.45, 'rgba(30, 64, 140, 0.68)');
    gradient.addColorStop(0.68, 'rgba(37, 99, 235, 0.78)');
    gradient.addColorStop(0.86, 'rgba(217, 152, 40, 0.86)');
    gradient.addColorStop(1.00, 'rgba(245, 158, 11, 0.94)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 1);

    this.palette = context.getImageData(0, 0, 256, 1).data;
    return this.palette;
  }

  private draw(dpr: number): void {
    const map = this.map;
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!map || !ctx || !canvas) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.points.length === 0) return;

    ctx.scale(dpr, dpr);

    // Yakınlaştıkça noktalar büyüsün ki uzaktan "leke", yakından "odak" olsun.
    const zoom = map.getZoom();
    const zoomFactor = Math.max(0.55, Math.min(2.4, 1 + (zoom - 6) * 0.22));
    const radius = this.options.radius * zoomFactor;
    const blur = this.options.blur * zoomFactor;

    const stamp = this.createStamp(radius, blur);
    const offset = radius + blur;
    const size = map.getSize();

    ctx.globalAlpha = 1;
    for (const point of this.points) {
      const p = map.latLngToContainerPoint([point.latitude, point.longitude]);
      // Görünür alanın belirgin şekilde dışındaki noktalar çizilmez.
      if (p.x < -offset || p.y < -offset || p.x > size.x + offset || p.y > size.y + offset) continue;

      ctx.globalAlpha = Math.max(0.06, Math.min(1, point.intensity));
      ctx.drawImage(stamp, p.x - offset, p.y - offset);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // İkinci geçiş: alfa kanalını renk paletiyle eşle.
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const palette = this.buildPalette();
    const maxOpacity = this.options.maxOpacity;

    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha === 0) continue;
      const index = alpha * 4;
      pixels[i] = palette[index] ?? 0;
      pixels[i + 1] = palette[index + 1] ?? 0;
      pixels[i + 2] = palette[index + 2] ?? 0;
      pixels[i + 3] = Math.round(alpha * maxOpacity);
    }

    ctx.putImageData(image, 0, 0);
  }
}
