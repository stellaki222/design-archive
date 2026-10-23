import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  doc, 
  deleteDoc, 
  updateDoc, 
  increment
} from 'firebase/firestore';
import { 
  Plus, 
  Search, 
  X, 
  Image as ImageIcon, 
  Tag, 
  LayoutGrid, 
  Trash2, 
  ExternalLink,
  Loader2,
  PenTool,
  Link as LinkIcon,
  MessageSquare,
  Upload,
  Sparkles,
  BarChart3,
  User,
  Edit,
  Trophy,
  Bot,
  Download,
  Calendar,
  Wand2,
  RotateCcw,
  ArrowUpDown,
  AlertCircle,
  Box,
  Layers,
  Eye,
  Settings2,
  Sun,
  Move3d,
  ChevronDown,
  Crop
} from 'lucide-react';

// --- Gemini API Configuration & Helper ---
const apiKey = ""; // Runtime environment provides this.

const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return await response.json();
      
      if (i === retries) {
         const errorText = await response.text().catch(() => "Unknown error");
         throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    } catch (error) {
      if (i === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
};

const callGeminiVision = async (base64Image, prompt) => {
  try {
    const base64Data = base64Image.split(',')[1];
    const mimeType = base64Image.split(';')[0].split(':')[1];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { 
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from AI');
    
    const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    throw error;
  }
};

const callImagen = async (prompt) => {
  try {
    const result = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: prompt }],
          parameters: { sampleCount: 1 }
        })
      }
    );

    const base64Image = result.predictions?.[0]?.bytesBase64Encoded;
    if (!base64Image) throw new Error('Image generation failed');
    return `data:image/png;base64,${base64Image}`;
  } catch (error) {
    console.error("Imagen Error:", error);
    throw error;
  }
};

// --- Image-to-Image 3D Generation with Fallback ---
const callGeminiImageTo3D = async (base64Image, material, strength, angle, shadow, customPrompt) => {
  const base64Data = base64Image.split(',')[1];
  const mimeType = base64Image.split(';')[0].split(':')[1];

  let strengthPrompt = "Standard 3D render";
  if (strength === "Weak") strengthPrompt = "Clean and simple 3D, minimal extrusion, flat design style 3D";
  if (strength === "Medium") strengthPrompt = "Balanced 3D depth, smooth shading, standard high-quality render";
  if (strength === "Strong") strengthPrompt = "Cinema 4D style, Blender Cycles render, Octane render, hyper-realistic, 8k resolution, ray tracing, thick puffy volume, highly detailed textures, studio lighting, ambient occlusion";

  const prompt = `
    Transform this 2D image into a professional high-end 3D graphic.
    Use the style of professional 3D tools like Cinema 4D or Blender.
    
    Additional Instructions: ${customPrompt || "None"}

    Render Settings:
    - Style/Engine: ${strengthPrompt}
    - Material: ${material} (High fidelity textures)
    - Camera Angle: ${angle} (Strictly match this view)
    - Shadows: ${shadow}
    - Background: Pure white background, isolated object (cutout/nukki).
    - Lighting: Professional studio lighting, softbox lighting, global illumination.
    
    Ensure the output looks like a finished 3D asset, not a drawing.
    Output ONLY the image.
  `;

  try {
    const result = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { 
            responseModalities: ["TEXT", "IMAGE"]
          }
        })
      },
      1, 
      500
    );

    const inlineData = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
    if (inlineData) {
      return `data:${inlineData.mimeType};base64,${inlineData.data}`;
    }
    throw new Error("No image generated by primary model");
  } catch (error) {
    console.warn("Primary 3D Gen failed (401/403). Engaging Fallback Pipeline...", error);
    
    try {
      const analysisPrompt = "Describe the main subject, shapes, and colors of this image in extreme detail (under 40 words) so it can be recreated as a 3D object.";
      const analysisResult = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: analysisPrompt },
                { inlineData: { mimeType: mimeType, data: base64Data } }
              ]
            }],
            generationConfig: { responseMimeType: "text/plain" }
          })
        }
      );
      
      const description = analysisResult.candidates?.[0]?.content?.parts?.[0]?.text || "A simple 2D object";
      
      const finalPrompt = `A high-end professional 3D render of: ${description.replace(/\n/g, ' ')}. 
      Style: ${strengthPrompt}. Material: ${material}. Camera Angle: ${angle}. Shadows: ${shadow}. 
      Extra: ${customPrompt || "None"}. Pure white background, high quality studio lighting.`;
      
      const imgResult = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: finalPrompt }],
            parameters: { sampleCount: 1 }
          })
        }
      );

      const fallbackBase64 = imgResult.predictions?.[0]?.bytesBase64Encoded;
      if (!fallbackBase64) throw new Error('Fallback image generation failed');
      return `data:image/png;base64,${fallbackBase64}`;
    } catch (fallbackError) {
      console.error("Fallback Pipeline Error:", fallbackError);
      throw fallbackError;
    }
  }
};

// --- Helper: Image Compression ---
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const MAX_SIZE_BYTES = 950 * 1024; 
    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      
      img.onload = () => {
        if (event.target.result.length < MAX_SIZE_BYTES) {
          resolve(event.target.result);
          return;
        }

        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_DIMENSION = 1920; 
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.7;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        if (dataUrl.length > MAX_SIZE_BYTES) {
          quality = 0.5;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUrl);
      };
      
      img.onerror = (err) => reject(err);
    };
    
    reader.onerror = (err) => reject(err);
  });
};

// --- Helper: Crop and Download ---
const cropAndDownload = (imageSrc, ratio, title) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageSrc;
  img.onload = () => {
    let width = img.width;
    let height = img.height;
    let newWidth = width;
    let newHeight = height;

    if (ratio !== 'original') {
      const [rW, rH] = ratio.split(':').map(Number);
      const targetRatio = rW / rH;
      const currentRatio = width / height;

      if (currentRatio > targetRatio) {
        newWidth = height * targetRatio;
        newHeight = height;
      } else {
        newWidth = width;
        newHeight = width / targetRatio;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    
    const startX = (width - newWidth) / 2;
    const startY = (height - newHeight) / 2;

    ctx.drawImage(img, startX, startY, newWidth, newHeight, 0, 0, newWidth, newHeight);
    
    const link = document.createElement('a');
    link.download = `Archive_${title.replace(/\s+/g, '_')}_${ratio}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
};

// --- Firebase Configuration & Initialization ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false, onMouseDown }) => {
  const baseStyle = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-black text-white hover:bg-gray-800 disabled:opacity-50",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    ghost: "bg-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50",
    ai: "bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-500 text-white hover:opacity-90 border border-transparent shadow-sm shadow-emerald-200",
    purple: "bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:opacity-90 border border-transparent shadow-sm"
  };

  return (
    <button 
      type={type} 
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

const Badge = ({ children, onClick, active = false }) => (
  <span 
    onClick={onClick}
    className={`
      inline-flex items-center px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition-colors whitespace-nowrap
      ${active 
        ? 'bg-black text-white' 
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
    `}
  >
    {children}
  </span>
);

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[85vh]">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- Interactive 3D Angle Selector ---
const AngleSelector = ({ image, currentAngle, onChange, onDragStart, onDragEnd, children, className = "" }) => {
  const [rotation, setRotation] = useState({ x: -15, y: 35 });
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [angleDisplay, setAngleDisplay] = useState("정면 (Front)");

  const getDisplayName = (internalName) => {
    const map = {
      "Front View": "정면 (Front)",
      "High Angle": "하이 앵글 (Top)",
      "Low Angle": "로우 앵글 (Bottom)",
      "Right View": "우측면 (Right)",
      "Back View": "후면 (Back)",
      "Left View": "좌측면 (Left)",
      "Isometric Right": "아이소메트릭 우측",
      "Isometric Left": "아이소메트릭 좌측",
    };
    return map[internalName] || internalName;
  };

  useEffect(() => {
    if(!isDragging) {
       setAngleDisplay(getDisplayName(currentAngle));
    }
  }, [currentAngle, isDragging]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    if (onDragStart) onDragStart();
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;

    let newX = rotation.x - dy * 0.5;
    let newY = rotation.y + dx * 0.5;

    newX = Math.max(-90, Math.min(90, newX));

    setRotation({ x: newX, y: newY });
    startPos.current = { x: e.clientX, y: e.clientY };
    
    updateAngleName(newX, newY);
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      if (onDragEnd) onDragEnd();
    }
  };

  const updateAngleName = (x, y) => {
    let normY = y % 360;
    if (normY < 0) normY += 360;

    let internalName = "Front View";

    if (x > 45) internalName = "High Angle";
    else if (x < -45) internalName = "Low Angle";
    else {
      if (normY >= 45 && normY < 135) internalName = "Right View";
      else if (normY >= 135 && normY < 225) internalName = "Back View";
      else if (normY >= 225 && normY < 315) internalName = "Left View";
      else if ((normY >= 315) || (normY < 45)) internalName = "Front View";
      
      if (x > 15 && x < 45) {
        if (normY > 20 && normY < 70) internalName = "Isometric Right";
        if (normY > 290 && normY < 340) internalName = "Isometric Left";
      }
    }
    
    setAngleDisplay(getDisplayName(internalName));
    onChange(internalName);
  };

  return (
     <div 
       className={`relative w-full bg-gray-900 rounded-lg overflow-hidden cursor-move flex items-center justify-center group ${className}`}
       onMouseDown={handleMouseDown}
       onMouseMove={handleMouseMove}
       onMouseUp={handleMouseUp}
       onMouseLeave={handleMouseUp}
       style={{ perspective: '1000px' }}
     >
        {children}
        
        <div 
            className={`relative w-full h-full flex items-center justify-center ${children ? 'pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity' : ''}`}
            style={{ transformStyle: 'preserve-3d' }}
        >
            <div 
              className="absolute w-[400px] h-[400px] border border-white/10 rounded-full"
              style={{ 
                 transform: `rotateX(${rotation.x + 90}deg) rotateZ(${-rotation.y}deg) translateZ(-80px)`,
                 background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%)',
                 pointerEvents: 'none'
              }}
            >
              <div 
                className="w-full h-full" 
                style={{ 
                  backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', 
                  backgroundSize: '40px 40px' 
                }}
              />
            </div>

            <div 
                className="relative w-40 h-40"
                style={{ 
                  transformStyle: 'preserve-3d', 
                  transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
                  transition: isDragging ? 'none' : 'transform 0.5s ease'
                }}
            >
                <div className="absolute inset-0 bg-white border-2 border-purple-400 flex items-center justify-center backface-hidden shadow-[0_0_30px_rgba(168,85,247,0.4)]" style={{ transform: 'translateZ(80px)' }}>
                    {image ? <img src={image} className="w-full h-full object-cover" alt="Front" /> : <div className="text-xs text-gray-800 font-bold">FRONT</div>}
                </div>
                <div className="absolute inset-0 bg-gray-800 border border-gray-600 flex items-center justify-center backface-hidden" style={{ transform: 'rotateY(180deg) translateZ(80px)' }}><div className="text-xs text-gray-400 font-bold">BACK</div></div>
                <div className="absolute inset-0 bg-gray-700 border border-gray-600 flex items-center justify-center backface-hidden" style={{ transform: 'rotateY(90deg) translateZ(80px)' }}><div className="text-xs text-gray-400 font-bold">RIGHT</div></div>
                <div className="absolute inset-0 bg-gray-700 border border-gray-600 flex items-center justify-center backface-hidden" style={{ transform: 'rotateY(-90deg) translateZ(80px)' }}><div className="text-xs text-gray-400 font-bold">LEFT</div></div>
                <div className="absolute inset-0 bg-gray-600 border border-gray-600 flex items-center justify-center backface-hidden" style={{ transform: 'rotateX(90deg) translateZ(80px)' }}><div className="text-xs text-gray-400 font-bold">TOP</div></div>
                <div className="absolute inset-0 bg-gray-600 border border-gray-600 flex items-center justify-center backface-hidden" style={{ transform: 'rotateX(-90deg) translateZ(80px)' }}><div className="text-xs text-gray-400 font-bold">BOTTOM</div></div>
            </div>
        </div>
        
        <div className={`absolute bottom-4 left-4 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none shadow-lg font-bold border border-white/10 z-20 flex items-center gap-2`}>
          <Move3d size={12} className="text-purple-400"/> {angleDisplay}
        </div>
     </div>
  );
};


// --- Generate3DModal ---
const Generate3DModal = ({ isOpen, onClose, onRegisterImage }) => {
  const [sourceImage, setSourceImage] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [options, setOptions] = useState({
    material: 'Clay',
    strength: 'Strong',
    angle: 'Front View',
    shadow: 'Soft shadows'
  });

  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setSourceImage(compressed);
      setResultImage(null); 
    } catch (err) {
      console.error(err);
      alert("이미지 로드 중 오류가 발생했습니다.");
    }
  };

  const handleGenerate = async () => {
    if (!sourceImage) return;
    setIsGenerating(true);
    try {
      const result = await callGeminiImageTo3D(
        sourceImage, 
        options.material, 
        options.strength, 
        options.angle,
        options.shadow,
        customPrompt
      );
      setResultImage(result);
    } catch (error) {
      console.error(error);
      alert("3D 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRotationEnd = () => {
    setIsDragging(false);
    setTimeout(() => {
       if(sourceImage && resultImage) handleGenerate();
    }, 100);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="2D to 3D 그래픽 생성">
      <div className="flex flex-col md:flex-row gap-6 h-[70vh]">
        <div className="w-full md:w-5/12 flex flex-col gap-6 overflow-y-auto pr-2">
            <div className="space-y-2">
               <label className="text-sm font-bold text-gray-900">1. 원본 이미지</label>
               <div className="w-full aspect-video rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center relative overflow-hidden hover:bg-gray-100 transition-colors cursor-pointer group">
                  {sourceImage ? (
                    <>
                      <img src={sourceImage} alt="Source" className="w-full h-full object-contain p-4" />
                      <button 
                        onClick={(e) => { 
                           e.stopPropagation();
                           setSourceImage(null); 
                           setResultImage(null); 
                        }}
                        className="absolute top-2 right-2 bg-white p-1.5 rounded-full shadow border hover:bg-red-50 text-red-500 z-10"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                       <Upload className="text-gray-400 mb-2 group-hover:scale-110 transition-transform" />
                       <span className="text-sm text-gray-500 font-bold">이미지 업로드</span>
                       <span className="text-xs text-gray-400 mt-1">2D 아이콘, 스케치</span>
                    </>
                  )}
                  <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
               </div>
            </div>

            <div className="space-y-4 flex-1">
               <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                 <Settings2 size={18} className="text-gray-900" />
                 <span className="text-sm font-bold text-gray-900">스타일 세부 설정</span>
               </div>
               
               <div className="space-y-3">
                 <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-500">재질 (Material)</label>
                      <select 
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500/20 outline-none"
                        value={options.material}
                        onChange={e => setOptions({...options, material: e.target.value})}
                      >
                        <option value="Clay texture, matte finish, soft edges">클레이 (Clay)</option>
                        <option value="Translucent glass, refractive, shiny">유리 (Glass)</option>
                        <option value="Polished metal, reflective, chrome">금속 (Metal)</option>
                        <option value="Plastic, glossy, vibrant">플라스틱 (Plastic)</option>
                      </select>
                    </div>
                    
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-500">초기 카메라 각도</label>
                      <select 
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500/20 outline-none"
                        value={options.angle}
                        onChange={e => setOptions({...options, angle: e.target.value})}
                      >
                        <option value="Front View">정면 (Front)</option>
                        <option value="High Angle">하이 앵글 (Top)</option>
                        <option value="Low Angle">로우 앵글 (Bottom)</option>
                        <option value="Right View">우측면 (Right)</option>
                        <option value="Back View">후면 (Back)</option>
                        <option value="Left View">좌측면 (Left)</option>
                        <option value="Isometric Right">아이소메트릭 우측</option>
                        <option value="Isometric Left">아이소메트릭 좌측</option>
                      </select>
                    </div>
                 </div>

                 <div className="space-y-1">
                   <label className="text-xs font-semibold text-gray-500">입체감 강도</label>
                   <div className="grid grid-cols-3 gap-2">
                      {['Weak', 'Medium', 'Strong'].map((level) => (
                        <button
                          key={level}
                          onClick={() => setOptions({...options, strength: level})}
                          className={`py-2 text-xs rounded-lg border font-medium transition-all
                            ${options.strength === level 
                              ? 'bg-purple-50 border-purple-200 text-purple-700 ring-1 ring-purple-200' 
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          {level === 'Weak' ? '약하게' : level === 'Medium' ? '중간' : '강하게'}
                        </button>
                      ))}
                   </div>
                 </div>

                 <div className="space-y-1">
                   <label className="text-xs font-semibold text-gray-500">그림자 설정</label>
                   <select 
                     className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500/20 outline-none"
                     value={options.shadow}
                     onChange={e => setOptions({...options, shadow: e.target.value})}
                   >
                     <option value="No shadows, flat lighting">없음</option>
                     <option value="Soft shadows, ambient occlusion">부드럽게</option>
                     <option value="Hard shadows, direct lighting">강하게</option>
                   </select>
                 </div>
                 
                 <div className="space-y-1 pt-2">
                   <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                     <MessageSquare size={12}/> 추가 요청사항
                   </label>
                   <input 
                     type="text"
                     className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500/20 outline-none transition-colors"
                     placeholder="예: 파란색으로, 더 둥글게 만들어줘..."
                     value={customPrompt}
                     onChange={e => setCustomPrompt(e.target.value)}
                   />
                 </div>
               </div>
            </div>

            <Button 
               onClick={handleGenerate} 
               variant="purple" 
               disabled={!sourceImage || isGenerating}
               className="w-full py-3 shadow-md"
            >
               {isGenerating ? (
                 <><Loader2 className="animate-spin" size={18} /> 고화질 렌더링 중...</>
               ) : (
                 <><Wand2 size={18} /> 지금 생성하기</>
               )}
            </Button>
        </div>
        
        <div className="w-full md:w-7/12 flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-800 relative shadow-inner">
           {sourceImage ? (
              <div className="relative w-full h-full">
                 <AngleSelector 
                    image={sourceImage}
                    currentAngle={options.angle}
                    onChange={(angle) => setOptions(prev => ({...prev, angle}))}
                    onDragStart={() => setIsDragging(true)}
                    onDragEnd={handleRotationEnd}
                    className="w-full h-full rounded-none bg-transparent"
                 >
                     {resultImage && !isDragging && !isGenerating && (
                        <div className="absolute inset-0 z-20 bg-gray-50 flex items-center justify-center cursor-move group overflow-hidden">
                           <img 
                              src={resultImage} 
                              alt="3D Result" 
                              className="w-full h-full object-contain p-8 pointer-events-none drop-shadow-xl" 
                           />
                           
                           <div className="absolute top-4 left-0 right-0 text-center pointer-events-none">
                              <span className="text-xs font-bold text-gray-600 bg-white/80 px-4 py-2 rounded-full backdrop-blur-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 w-fit mx-auto">
                                 <Move3d size={14} className="text-purple-600"/> 드래그하여 각도 변경
                              </span>
                           </div>

                           <div className="absolute bottom-4 right-4 flex items-center gap-2 z-30 pointer-events-auto">
                              <button
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    const promptData = `Material: ${options.material}, Strength: ${options.strength}, Angle: ${options.angle}, Shadow: ${options.shadow}, Custom: ${customPrompt}`;
                                    onRegisterImage(resultImage, promptData);
                                 }}
                                 className="bg-white px-4 py-2.5 rounded-full shadow-lg border border-purple-100 hover:bg-purple-50 text-purple-700 transition-transform hover:scale-105 flex items-center gap-2 font-bold text-sm"
                                 title="아카이브에 바로 등록하기"
                              >
                                 <Plus size={16} /> 아카이브 등록
                              </button>
                           </div>
                        </div>
                     )}
                 </AngleSelector>
                 
                 {isGenerating && (
                    <div className="absolute inset-0 z-30 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
                       <Loader2 className="animate-spin text-purple-400 mb-3" size={48} />
                       <span className="text-lg font-bold text-white">3D 변환 중...</span>
                       <span className="text-sm text-gray-400 mt-1">잠시만 기다려주세요 (고화질 렌더링)</span>
                    </div>
                 )}
              </div>
           ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
                 <Box size={64} className="mb-4 text-gray-700" />
                 <h4 className="text-lg font-bold text-gray-400">3D 미리보기 영역</h4>
                 <p className="text-sm mt-2 max-w-xs text-gray-600">
                   왼쪽에서 이미지를 업로드하면<br/>이곳에서 3D 공간을 제어할 수 있습니다.
                 </p>
              </div>
           )}
        </div>
      </div>
    </Modal>
  );
};


const ImageCard = ({ asset, onClick }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div 
      onClick={() => onClick(asset)}
      className="group relative mb-4 break-inside-avoid rounded-xl overflow-hidden bg-white cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100"
    >
      <div className={`aspect-w-16 aspect-h-9 bg-gray-100 relative ${!isLoaded ? 'animate-pulse min-h-[200px]' : ''}`}>
        <img 
          src={asset.imageUrl} 
          alt={asset.title}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={`w-full h-auto object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onError={(e) => {
            e.target.onerror = null; 
            e.target.src = "https://placehold.co/600x400/f3f4f6/9ca3af?text=Image+Error";
          }}
        />
        
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
           <div className="text-white transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
             <p className="text-xs font-medium opacity-80 mb-1">Uploaded by</p>
             <div className="flex items-center gap-2">
               <div className="bg-white/20 p-1.5 rounded-full">
                 <User size={14} />
               </div>
               <span className="font-semibold text-sm">{asset.uploaderName || "익명"}</span>
             </div>
           </div>
        </div>
      </div>
      
      <div className="p-4">
        <h4 className="font-bold text-gray-900 mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">
          {asset.title}
        </h4>
        <div className="flex flex-wrap gap-1 mt-2">
          {asset.tags.slice(0, 3).map((tag, idx) => (
            <span key={idx} className="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded border border-gray-100">
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const DetailModal = ({ asset, isOpen, onClose, onDelete, onEdit, currentUserId, assets = [], onSelectAsset }) => {
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [selectedView, setSelectedView] = useState("Original Style");

  useEffect(() => {
    if (isOpen) {
      setGeneratedImage(null);
      setIsGenerating(false);
      setDownloadMenuOpen(false);
      setSelectedView("Original Style");
    }
  }, [isOpen, asset]);

  if (!isOpen || !asset) return null;

  const isOwner = currentUserId === asset.userId;

  const relatedAssets = assets.filter(
    a => a.uploaderName === asset.uploaderName && a.id !== asset.id
  ).slice(0, 4); 

  const handleGenerateSimilar = async () => {
    setIsGenerating(true);
    try {
      const assetRef = doc(db, 'artifacts', appId, 'public', 'data', 'design_assets', asset.id);
      await updateDoc(assetRef, {
        generationCount: increment(1)
      });

      let viewPrompt = "";
      switch (selectedView) {
        case "Side View": viewPrompt = "Side profile view, from the side"; break;
        case "Front View": viewPrompt = "Front facing view, symmetrical"; break;
        case "Top View": viewPrompt = "Top-down view, bird's eye view, flat lay"; break;
        case "Close-up": viewPrompt = "Close-up shot, detailed macro view, zoomed in"; break;
        case "Zoomed Out": viewPrompt = "Wide angle shot, zoomed out view, environment visible, 0.5x zoom"; break;
        default: viewPrompt = "Similar style and composition";
      }

      let promptToUse = asset.prompt;
      if (!promptToUse) {
        promptToUse = `Generate a high quality image of ${asset.title}. ${asset.description || ''}. Style: ${asset.tags.join(', ')}. ${viewPrompt}`;
      } else {
        promptToUse = `${promptToUse}. ${viewPrompt}`;
      }
      
      const imageUrl = await callImagen(promptToUse);
      setGeneratedImage(imageUrl);
    } catch (error) {
      console.error("Generation error", error);
      alert("이미지 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRatioDownload = (ratio) => {
    try {
      const assetRef = doc(db, 'artifacts', appId, 'public', 'data', 'design_assets', asset.id);
      updateDoc(assetRef, {
        downloadCount: increment(1)
      });
    } catch (e) {
      console.error("Tracking error", e);
    }

    cropAndDownload(asset.imageUrl, ratio, asset.title);
    setDownloadMenuOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className="flex-1 bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden group">
          <img 
            src={asset.imageUrl} 
            alt={asset.title} 
            className="max-w-full max-h-full object-contain shadow-lg"
          />
        </div>

        <div className="w-full md:w-96 bg-white border-l flex flex-col h-full">
          <div className="flex justify-between items-center p-4 border-b">
            <h3 className="font-bold text-gray-900">상세 정보</h3>
            <div className="flex gap-2">
              <div className="relative">
                <button 
                  onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
                  className="p-1 hover:bg-gray-100 rounded-full text-gray-600 hover:text-blue-600 transition-colors flex items-center gap-1"
                  title="다운로드"
                >
                  <Download size={20} />
                  <ChevronDown size={14} />
                </button>
                {downloadMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-32 bg-white rounded-lg shadow-xl border border-gray-100 z-50 overflow-hidden">
                    {['original', '3:4', '3:1', '1:1', '2:1', '16:9'].map(ratio => (
                      <button
                        key={ratio}
                        onClick={() => handleRatioDownload(ratio)}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                         {ratio === 'original' ? '원본' : ratio}
                         {ratio !== 'original' && <Crop size={12} className="text-gray-400"/>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isOwner && (
                <button 
                  onClick={() => onEdit(asset)}
                  className="p-1 hover:bg-gray-100 rounded-full text-gray-600 hover:text-blue-600 transition-colors"
                  title="수정하기"
                >
                  <Edit size={20} />
                </button>
              )}
              <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} />
              </button>
            </div>
          </div>
          
          <div className="p-6 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold px-2 py-1 bg-gray-100 rounded text-gray-600">
                {asset.uploaderName || "익명"}
              </span>
              <span className="text-xs text-gray-400">
                {asset.createdAt?.toDate().toLocaleDateString()}
              </span>
            </div>

            <div className="flex gap-4 mb-4 text-xs text-gray-500">
               <div className="flex items-center gap-1">
                 <Download size={12} />
                 <span>{asset.downloadCount || 0} 다운로드</span>
               </div>
               <div className="flex items-center gap-1">
                 <Wand2 size={12} />
                 <span>{asset.generationCount || 0} 생성됨</span>
               </div>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-4">{asset.title}</h2>
            
            <div className="flex flex-wrap gap-2 mb-6">
              {asset.tags.map((tag, i) => (
                <span key={i} className="text-sm px-2 py-1 bg-blue-50 text-blue-700 rounded-md font-medium">
                  #{tag}
                </span>
              ))}
            </div>

            <div className="space-y-6">
              {asset.figmaUrl && (
                <a 
                  href={asset.figmaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full p-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
                >
                  <PenTool size={18} />
                  Figma 파일 열기
                </a>
              )}

              {asset.prompt && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <MessageSquare size={14} />
                    사용된 프롬프트
                  </h4>
                  <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-white p-3 rounded border border-gray-200">
                    {asset.prompt}
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">상세 설명</h4>
                <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {asset.description || "설명이 없습니다."}
                </p>
              </div>

              {relatedAssets.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    {asset.uploaderName}님의 다른 디자인
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {relatedAssets.map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => onSelectAsset(item)}
                        className="aspect-square rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:border-black hover:opacity-80 transition-all"
                        title={item.title}
                      >
                        <img 
                          src={item.imageUrl} 
                          alt={item.title} 
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t">
                <div className="mb-3">
                  <span className="text-xs font-bold text-gray-500 mb-2 block">생성 옵션 선택</span>
                  <div className="flex flex-wrap gap-2">
                    {["Original Style", "Side View", "Front View", "Top View", "Close-up", "Zoomed Out"].map(view => (
                      <button
                        key={view}
                        onClick={() => setSelectedView(view)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${selectedView === view ? 'bg-teal-50 border-teal-200 text-teal-700 font-bold' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      >
                        {view === "Original Style" ? "기본" : 
                         view === "Side View" ? "옆모습" : 
                         view === "Front View" ? "앞모습" : 
                         view === "Top View" ? "윗모습" : 
                         view === "Close-up" ? "클로즈업" : "2배 줌아웃"}
                      </button>
                    ))}
                  </div>
                </div>

                {!generatedImage ? (
                  <Button 
                    onClick={handleGenerateSimilar} 
                    variant="ai" 
                    className="w-full"
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <><Loader2 className="animate-spin" size={16}/> 생성 중...</>
                    ) : (
                      <><Wand2 size={16}/> 이 이미지와 비슷한 이미지 생성하기</>
                    )}
                  </Button>
                ) : (
                  <div className="bg-teal-50 p-4 rounded-xl border border-teal-100 space-y-3 animate-in fade-in slide-in-from-bottom-2">
                    <h4 className="font-bold text-teal-900 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><Sparkles size={18} /> 생성된 이미지</span>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={handleGenerateSimilar} 
                          disabled={isGenerating}
                          className="p-1.5 bg-white border border-teal-200 rounded-full text-teal-600 hover:bg-teal-50 hover:text-teal-800 transition-colors shadow-sm disabled:opacity-50"
                          title="다시 생성하기"
                        >
                          <RotateCcw size={14} className={isGenerating ? "animate-spin" : ""} />
                        </button>
                        <button onClick={() => setGeneratedImage(null)} className="text-xs underline text-teal-700">닫기</button>
                      </div>
                    </h4>
                    <div className="aspect-square w-full bg-gray-200 rounded-lg overflow-hidden relative border border-teal-200">
                       {isGenerating && (
                         <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10">
                           <Loader2 className="animate-spin text-teal-600" size={32} />
                         </div>
                       )}
                       <img src={generatedImage} alt="Generated" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex gap-2">
                        <a 
                          href={generatedImage} 
                          download="Generated_Design.png" 
                          className="flex-1 text-center py-2 bg-white border border-teal-200 rounded text-sm font-medium text-teal-700 hover:bg-teal-50"
                        >
                          저장하기
                        </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="p-4 border-t bg-gray-50">
              <Button onClick={() => onDelete(asset.id)} variant="danger" className="w-full">
                <Trash2 size={16} /> 삭제하기
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Stats Modal Component ---
const StatsModal = ({ isOpen, onClose, assets, onSelectAsset }) => {
  const [activeTab, setActiveTab] = useState('downloads'); 

  const sortedAssets = useMemo(() => {
    if (!isOpen) return []; 
    return [...assets].sort((a, b) => {
      if (activeTab === 'generations') {
        return (b.generationCount || 0) - (a.generationCount || 0);
      }
      return (b.downloadCount || 0) - (a.downloadCount || 0);
    }).slice(0, 10); 
  }, [assets, activeTab, isOpen]);

  const maxVal = useMemo(() => {
    if (sortedAssets.length === 0) return 0;
    const key = activeTab === 'generations' ? 'generationCount' : 'downloadCount';
    return Math.max(...sortedAssets.map(a => a[key] || 0)) || 1;
  }, [sortedAssets, activeTab]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Image Data">
      <div className="space-y-6">
        {/* Ranking Tabs */}
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
          <button 
            onClick={() => setActiveTab('downloads')}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'downloads' ? 'bg-white shadow-sm text-[#4154FF]' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Best Download
          </button>
          <button 
            onClick={() => setActiveTab('generations')}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'generations' ? 'bg-white shadow-sm text-teal-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Best AI Creation
          </button>
        </div>
        
        {/* Bar Chart Visualization */}
        <div className="space-y-4">
          {sortedAssets.map((asset, index) => {
            const val = activeTab === 'generations' ? (asset.generationCount || 0) : (asset.downloadCount || 0);
            const percent = (val / maxVal) * 100;
            
            return (
              <div 
                key={asset.id} 
                className="flex items-center gap-4 group cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors" 
                onClick={() => onSelectAsset(asset)}
              >
                {/* Rank */}
                <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0
                   ${index === 0 ? 'bg-yellow-100 text-yellow-700' : 
                     index === 1 ? 'bg-gray-200 text-gray-700' : 
                     index === 2 ? 'bg-orange-100 text-orange-800' : 'text-gray-400'}
                `}>
                  {index + 1}
                </div>
                
                {/* Thumbnail */}
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200 bg-gray-100">
                   <img src={asset.imageUrl} alt={asset.title} className="w-full h-full object-cover" />
                </div>
                
                {/* Bar area */}
                <div className="flex-1 min-w-0">
                   <div className="flex justify-between text-xs mb-1.5">
                      <span className="font-semibold text-gray-900 truncate pr-2">{asset.title}</span>
                      <span className="font-bold text-gray-700 whitespace-nowrap">
                        {val} {activeTab === 'downloads' ? 'downloads' : 'gens'}
                      </span>
                   </div>
                   <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-700 ease-out ${activeTab === 'downloads' ? 'bg-[#4154FF]' : 'bg-teal-500'}`}
                        style={{ width: `${Math.max(percent, 5)}%` }}
                      />
                   </div>
                </div>
              </div>
            )
          })}
          {sortedAssets.length === 0 && (
            <div className="text-center py-10 text-gray-400 flex flex-col items-center">
               <BarChart3 className="mb-2 opacity-50" size={32} />
               <p>아직 데이터가 충분하지 않습니다.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

// --- Main Application Component ---

export default function App() {
  const [user, setUser] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [is3DModalOpen, setIs3DModalOpen] = useState(false); // State for 3D Modal
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState("전체");
  const [selectedUploader, setSelectedUploader] = useState(null);
  const [errors, setErrors] = useState({});

  const uploaderNameRef = useRef(null);
  const titleRef = useRef(null);
  const imageRef = useRef(null);
  const tagsRef = useRef(null);

  const initialFormState = {
    title: "",
    imageUrl: "",
    tags: "",
    description: "",
    prompt: "",
    figmaUrl: "",
    uploaderName: ""
  };
  const [newAsset, setNewAsset] = useState(initialFormState);
  const [editingId, setEditingId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      const savedName = localStorage.getItem('uploaderName');
      if (savedName) {
        setNewAsset(prev => ({ ...prev, uploaderName: savedName }));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'design_assets'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAssets(data);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Snapshot Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setUploadError("파일이 너무 큽니다. (10MB 이하만 가능)");
      return;
    }
    
    setUploadError("이미지 처리 중..."); 
    try {
      const compressedDataUrl = await compressImage(file);
      if (compressedDataUrl.length > 1048000) {
        setUploadError("이미지 용량이 너무 큽니다. 다른 이미지를 사용해주세요.");
        return;
      }
      setNewAsset(prev => ({ ...prev, imageUrl: compressedDataUrl }));
      setErrors(prev => ({ ...prev, imageUrl: "" })); 
      setUploadError(""); 
    } catch (err) {
      console.error("Compression error:", err);
      setUploadError("이미지 처리 중 오류가 발생했습니다.");
    }
  };

  const handleAiAutoFill = async () => {
    if (!newAsset.imageUrl) {
      alert("이미지를 먼저 업로드해주세요.");
      return;
    }
    setIsAiGenerating(true);
    try {
      const prompt = `
        Analyze this design image. 
        1. Select matching categories from: [인물, 그래픽, 배경, 3D, 교통].
        2. Generate 5-10 specific descriptive keywords for searchability (Korean).
        Return JSON format ONLY:
        {
          "title": "Creative Title (Korean)",
          "tags": "category, keyword1, keyword2...",
          "description": "Short description (Korean)",
          "prompt": "Reverse engineered AI prompt (English)"
        }
      `;
      const result = await callGeminiVision(newAsset.imageUrl, prompt);
      setNewAsset(prev => ({
        ...prev,
        title: result.title || prev.title,
        tags: result.tags || prev.tags,
        description: result.description || prev.description,
        prompt: result.prompt || prev.prompt
      }));
      setErrors(prev => ({ ...prev, title: "", tags: "" }));
    } catch (error) {
      console.error("AI Auto-fill failed", error);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleEditClick = (asset) => {
    setNewAsset({
      title: asset.title,
      imageUrl: asset.imageUrl,
      tags: asset.tags.join(', '),
      description: asset.description || "",
      prompt: asset.prompt || "",
      figmaUrl: asset.figmaUrl || "",
      uploaderName: asset.uploaderName || ""
    });
    setEditingId(asset.id);
    setSelectedAsset(null);
    setIsUploadOpen(true);
    setErrors({});
  };

  const handleUploadOrUpdate = async (e) => {
    e.preventDefault();
    
    const newErrors = {};
    if (!newAsset.uploaderName.trim()) newErrors.uploaderName = "닉네임(이름)을 입력해주세요.";
    if (!newAsset.title.trim()) newErrors.title = "제목을 입력해주세요.";
    if (!newAsset.tags.trim()) newErrors.tags = "태그를 입력해주세요.";
    if (!newAsset.imageUrl) newErrors.imageUrl = "이미지를 업로드해주세요.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      if (newErrors.uploaderName) uploaderNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (newErrors.title) titleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (newErrors.imageUrl) imageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (newErrors.tags) tagsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSubmitting(true);
    try {
      const tagArray = newAsset.tags.split(',').map(t => t.trim()).filter(t => t !== "");
      if (newAsset.uploaderName) localStorage.setItem('uploaderName', newAsset.uploaderName);

      const docData = {
        title: newAsset.title,
        imageUrl: newAsset.imageUrl,
        tags: tagArray,
        description: newAsset.description,
        prompt: newAsset.prompt,
        figmaUrl: newAsset.figmaUrl,
        uploaderName: newAsset.uploaderName, 
        type: 'image',
        downloadCount: editingId ? increment(0) : 0,
        generationCount: editingId ? increment(0) : 0
      };

      if (editingId) {
        const { downloadCount, generationCount, ...updateData } = docData;
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'design_assets', editingId), {
          ...updateData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'design_assets'), {
          ...docData,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      setIsUploadOpen(false);
      setNewAsset(initialFormState);
      setEditingId(null);
      setUploadError("");
      setErrors({});
    } catch (error) {
      console.error("Submit Error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirm("정말로 이 자료를 삭제하시겠습니까?")) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'design_assets', id));
        setSelectedAsset(null);
      } catch (error) {
        console.error("Delete Error:", error);
      }
    }
  };

  const allTags = ["전체", "인물", "그래픽", "배경", "3D", "교통"];

  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = 
        asset.title.toLowerCase().includes(searchLower) || 
        asset.tags.some(t => t.toLowerCase().includes(searchLower)) ||
        (asset.uploaderName && asset.uploaderName.toLowerCase().includes(searchLower)); 
      const matchesTag = activeTag === "전체" || asset.tags.includes(activeTag);
      const matchesUploader = !selectedUploader || asset.uploaderName === selectedUploader;
      return matchesSearch && matchesTag && matchesUploader;
    });
  }, [assets, searchQuery, activeTag, selectedUploader]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-[#4154FF]" size={48} />
          <p className="text-gray-500 font-medium">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-4">
          <div className="flex justify-center sm:justify-start">
             <div className="flex items-center gap-2 cursor-pointer" onClick={() => {
               setActiveTag("전체");
               setSelectedUploader(null);
               setSearchQuery("");
             }}>
                <div className="bg-[#4154FF] text-white p-2 rounded-lg shadow-md">
                  <LayoutGrid size={20} />
                </div>
                <h1 className="text-xl font-extrabold tracking-tight text-[#4154FF]">NOL Ai Design Archive</h1>
             </div>
          </div>

          <div className="flex gap-2 w-full">
             <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#4154FF] transition-colors" size={18} />
                <input 
                  type="text" 
                  placeholder="제목, 태그, 작성자 검색..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#4154FF]/20 focus:bg-white transition-all outline-none"
                />
             </div>
             
             {/* 3D Generate Button */}
             <Button 
                variant="ai"
                className="shadow-sm whitespace-nowrap bg-white text-teal-600 border border-teal-200 hover:bg-teal-50"
                onClick={() => setIs3DModalOpen(true)}
             >
                <Sparkles size={18} />
                <span className="hidden sm:inline">그래픽 생성하기</span>
             </Button>

             <Button 
               variant="primary" 
               className="shadow-sm whitespace-nowrap bg-[#4154FF] hover:bg-[#3545CC]"
               onClick={() => {
                 setNewAsset(prev => ({...initialFormState, uploaderName: prev.uploaderName})); 
                 setEditingId(null);
                 setIsUploadOpen(true);
                 setErrors({});
               }}
             >
               <Plus size={18} /> 
               <span className="hidden sm:inline">자료등록하기</span>
             </Button>
          </div>

          <div className="flex items-center justify-between overflow-hidden">
             <div className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-2 pb-1">
                {selectedUploader && (
                   <div className="flex items-center gap-2 pr-4 border-r border-gray-200 flex-shrink-0">
                      <span className="text-sm font-bold text-[#4154FF]">👤 {selectedUploader}</span>
                      <button 
                        onClick={() => setSelectedUploader(null)}
                        className="p-1 hover:bg-gray-200 rounded-full"
                      >
                        <X size={14} />
                      </button>
                   </div>
                )}
                {allTags.map(tag => (
                  <Badge 
                    key={tag} 
                    active={activeTag === tag}
                    onClick={() => setActiveTag(tag)}
                  >
                    {tag === '전체' ? '전체 보기' : `#${tag}`}
                  </Badge>
                ))}
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {filteredAssets.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-6 text-gray-300">
              <ImageIcon size={40} />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">검색 결과가 없습니다</h3>
            <p className="text-gray-500 mt-2">다른 검색어를 입력하거나 첫 번째 자료를 등록해보세요.</p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
            {filteredAssets.map(asset => (
              <ImageCard key={asset.id} asset={asset} onClick={setSelectedAsset} />
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-8 right-8 z-30">
        <button 
          onClick={() => setIsStatsOpen(true)}
          className="bg-black text-white p-4 rounded-full shadow-2xl hover:bg-gray-800 transition-all transform hover:scale-110 flex items-center justify-center border border-white/20"
          title="Image Data 보기"
        >
          <BarChart3 size={24} />
        </button>
      </div>

      <Modal 
        isOpen={isUploadOpen} 
        onClose={() => {
          setIsUploadOpen(false);
          setEditingId(null);
          setUploadError("");
          setErrors({});
        }}
        title={editingId ? "자료 수정하기" : "새 자료 등록"}
      >
        <form onSubmit={handleUploadOrUpdate} className="space-y-5">
          <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 flex gap-2 items-start border border-blue-100">
             <div className="mt-0.5"><AlertCircle size={14}/></div>
             <div>제목, 태그, 닉네임은 필수입니다.</div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-900 mb-1.5">
              닉네임 (이름) <span className="text-red-500">*</span>
            </label>
            <input 
              ref={uploaderNameRef}
              type="text" 
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 outline-none bg-gray-50 focus:bg-white transition-all ${errors.uploaderName ? 'border-red-500 ring-red-100' : 'border-gray-200 focus:ring-[#4154FF]/20'}`}
              placeholder="닉네임(이름)을 입력해주세요"
              value={newAsset.uploaderName}
              onChange={e => {
                setNewAsset({...newAsset, uploaderName: e.target.value});
                setErrors({...errors, uploaderName: ""});
              }}
            />
            {errors.uploaderName && <p className="text-xs text-red-500 mt-1 flex items-center gap-1 font-medium">{errors.uploaderName}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-900 mb-1.5">
              제목 <span className="text-red-500">*</span>
            </label>
            <input 
              ref={titleRef}
              type="text" 
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 outline-none bg-gray-50 focus:bg-white transition-all ${errors.title ? 'border-red-500 ring-red-100' : 'border-gray-200 focus:ring-[#4154FF]/20'}`}
              placeholder="예: 2026 메인 컨셉 아트"
              value={newAsset.title}
              onChange={e => {
                setNewAsset({...newAsset, title: e.target.value});
                setErrors({...errors, title: ""});
              }}
            />
            {errors.title && <p className="text-xs text-red-500 mt-1 flex items-center gap-1 font-medium">{errors.title}</p>}
          </div>
          
          <div>
            <label className="block text-sm font-bold text-gray-900 mb-1.5">
              이미지 업로드 <span className="text-red-500">*</span>
            </label>
            <div 
              ref={imageRef}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer relative ${errors.imageUrl ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
            >
              <input 
                type="file" 
                accept="image/*"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              {newAsset.imageUrl ? (
                <div className="relative w-full h-48 z-20">
                  <img src={newAsset.imageUrl} alt="Preview" className="w-full h-full object-contain rounded-lg shadow-sm" />
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation(); 
                      setNewAsset({...newAsset, imageUrl: ""});
                    }}
                    className="absolute -top-2 -right-2 bg-white p-1.5 rounded-full shadow-lg border hover:bg-red-50 text-red-500 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="text-center">
                   {uploadError === "이미지 처리 중..." ? (
                      <div className="flex flex-col items-center text-[#4154FF]">
                         <Loader2 className="animate-spin mb-3" size={28} />
                         <span className="text-sm font-semibold">이미지 최적화 중...</span>
                      </div>
                   ) : (
                    <>
                      <div className="bg-white p-4 rounded-full shadow-sm mb-4 inline-block">
                        <Upload className={errors.imageUrl ? 'text-red-400' : 'text-[#4154FF]'} size={24} />
                      </div>
                      <p className={`text-sm font-bold ${errors.imageUrl ? 'text-red-500' : 'text-gray-900'}`}>클릭하여 이미지 선택</p>
                      <p className="text-xs text-gray-500 mt-1">PNG, JPG (Max 10MB)</p>
                    </>
                   )}
                </div>
              )}
            </div>
            {errors.imageUrl && <p className="text-xs text-red-500 mt-1 flex items-center gap-1 font-medium">{errors.imageUrl}</p>}
          </div>
          
          {newAsset.imageUrl && !editingId && (
            <Button 
              onClick={handleAiAutoFill} 
              variant="ai" 
              className="w-full py-3 shadow-sm"
              disabled={isAiGenerating}
            >
              {isAiGenerating ? (
                <><Loader2 className="animate-spin" size={18} /> 분석 중...</>
              ) : (
                <><Sparkles size={18} /> AI 자동 입력 (제목/태그)</>
              )}
            </Button>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-900 mb-1.5">
              태그 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">(쉼표로 구분)</span>
            </label>
            <div className="relative group">
              <input 
                ref={tagsRef}
                type="text" 
                className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 outline-none bg-gray-50 focus:bg-white transition-all ${errors.tags ? 'border-red-500 ring-red-100' : 'border-gray-200 focus:ring-[#4154FF]/20'}`}
                placeholder="인물, 3D, 여름, 포스터..."
                value={newAsset.tags}
                onChange={e => {
                  setNewAsset({...newAsset, tags: e.target.value});
                  setErrors({...errors, tags: ""});
                }}
              />
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#4154FF]" size={16} />
            </div>
            {errors.tags && <p className="text-xs text-red-500 mt-1 flex items-center gap-1 font-medium">{errors.tags}</p>}
            <p className="text-[10px] text-gray-500 mt-2 flex items-center gap-1">
              <AlertCircle size={10}/> <strong>인물, 그래픽, 배경, 3D, 교통</strong> 중 한 가지는 꼭 포함해 주세요.
            </p>
          </div>
          
          <div className="space-y-4">
             <div>
               <label className="block text-sm font-bold text-gray-900 mb-1.5">Figma 링크</label>
               <div className="relative">
                 <input 
                   type="url" 
                   className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#4154FF]/20 outline-none bg-gray-50 focus:bg-white transition-all text-sm"
                   placeholder="https://figma.com/file/..."
                   value={newAsset.figmaUrl}
                   onChange={e => setNewAsset({...newAsset, figmaUrl: e.target.value})}
                 />
                 <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
               </div>
             </div>

             <div>
               <label className="block text-sm font-bold text-gray-900 mb-1.5">프롬프트</label>
               <div className="relative">
                 <textarea 
                   rows="3"
                   className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#4154FF]/20 outline-none bg-gray-50 focus:bg-white transition-all text-sm resize-none"
                   placeholder="사용한 AI 프롬프트를 적어주세요"
                   value={newAsset.prompt}
                   onChange={e => setNewAsset({...newAsset, prompt: e.target.value})}
                 />
                 <MessageSquare className="absolute left-3 top-3 text-gray-400" size={16} />
               </div>
             </div>

             <div>
                <label className="block text-sm font-bold text-gray-900 mb-1.5">상세 설명</label>
                <textarea 
                  rows="3"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#4154FF]/20 outline-none bg-gray-50 focus:bg-white transition-all text-sm resize-none"
                  placeholder="작업 의도나 참고 사항을 자유롭게 적어주세요"
                  value={newAsset.description}
                  onChange={e => setNewAsset({...newAsset, description: e.target.value})}
                />
             </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t">
            <Button variant="ghost" onClick={() => {
              setIsUploadOpen(false);
              setEditingId(null);
              setErrors({});
            }}>취소</Button>
            <Button 
              type="submit" 
              disabled={isSubmitting}
              className={`min-w-[120px] ${isSubmitting ? 'opacity-70' : 'bg-[#4154FF]'}`}
            >
              {isSubmitting ? (
                 <>
                   <Loader2 className="animate-spin" size={16} /> {editingId ? "수정 중" : "등록 중"}
                 </>
              ) : (editingId ? "수정 완료" : "등록하기")}
            </Button>
          </div>
        </form>
      </Modal>

      <Generate3DModal 
        isOpen={is3DModalOpen}
        onClose={() => setIs3DModalOpen(false)}
        onRegisterImage={(imageUrl, usedPrompt) => {
          setIs3DModalOpen(false);
          setNewAsset(prev => ({
            ...initialFormState,
            uploaderName: prev.uploaderName, 
            imageUrl: imageUrl,
            title: "AI 3D 그래픽",
            tags: "3D, AI생성",
            prompt: usedPrompt
          }));
          setEditingId(null);
          setIsUploadOpen(true);
          setErrors({});
        }}
      />

      <StatsModal 
        isOpen={isStatsOpen} 
        onClose={() => setIsStatsOpen(false)}
        assets={assets}
        onSelectAsset={setSelectedAsset}
      />

      <DetailModal 
        isOpen={!!selectedAsset}
        asset={selectedAsset}
        assets={assets}
        onSelectAsset={setSelectedAsset}
        onClose={() => setSelectedAsset(null)}
        onDelete={handleDelete}
        onEdit={handleEditClick}
        currentUserId={user?.uid}
      />
    </div>
  );
}
