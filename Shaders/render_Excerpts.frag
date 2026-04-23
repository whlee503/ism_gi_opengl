// Render.frag 발췌 코드

#version 430 core

layout(location = 0) out vec4 outDirect;   // 직접광 + Albedo
layout(location = 1) out vec4 outIndirect; // 간접광 (Noisy)
layout(location = 2) out vec4 outNormal;   // World Normal


uniform vec3 lightColor;
uniform vec3 lightPosition;
// Light.hpp에서 보낸 Uniform 수신
uniform vec3 lightDirection;
uniform float lightCutoff;
uniform float lightOuterCutoff;

uniform int showDirect;
uniform int showIndirect;

uniform sampler2D ismAtlas; // 거대 아틀라스 텍스처
uniform int gridCols;       // 16
uniform int gridRows;       // 16

uniform sampler2D directIsmTex; // 6번 슬롯
uniform mat4 shadowViewMat;

uniform int numVPLs;            // 실제 활성화된 VPL 개수 (vpls.size())

uniform float uTime;            // C++에서 보낸 시간 값

uniform float uMetalness;   // C++에서 보낼 금속성 값


// Uniform 배열 대신 SSBO 사용
struct VPL {
    vec4 pos;
    vec4 norm;
    vec4 color;
};
layout(std430, binding = 0) buffer VPLBuffer {
    VPL vpls[];
};



// ****************** ISM ********************
float getVisibility(int vplIdx, vec3 P, vec3 N) {
    vec3 lightPos = vpls[vplIdx].pos.xyz;
    vec3 lightDir = normalize(vpls[vplIdx].norm.xyz);    // VPL의 법선 (Paraboloid 기준축)
    
    vec3 diff = P - lightPos;
    float dist = length(diff); // 실제 거리
    
    // Parabolic Projection을 위한 로컬 좌표 변환 (ism.vert와 동일한 로직 필요)
    // 쉐이더 안에서 Basis를 또 구하는 건 비효율적이지만, 일단 구현의 편의를 위해 여기서 계산
    vec3 up = vec3(0, 1, 0);
    if (abs(lightDir.y) > 0.99) up = vec3(1, 0, 0);
    vec3 right = normalize(cross(up, lightDir));
    up = cross(lightDir, right);
    
    vec3 localPos;
    localPos.x = dot(diff, right);
    localPos.y = dot(diff, up);
    localPos.z = dot(diff, lightDir);
    
    // 뒷면이면 그림자 처리 (혹은 빛을 못 받음)
    if (localPos.z < 0.0) return 0.0;
    
    // Parabolic 좌표 계산 [-1, 1]
    vec2 parabCoords = localPos.xy / (dist + localPos.z);
    
    // 아틀라스 내 타일 좌표 계산
    int col = vplIdx % gridCols;
    int row = vplIdx / gridCols;
    
    // 타일 내 UV 좌표 [0, 1]로 변환 (중요: Texture UV는 0~1)
    // 아틀라스 전체에서 타일 하나의 크기 비율
    vec2 tileScale = vec2(1.0) / vec2(float(gridCols), float(gridRows));
    
    // 타일의 시작점 (좌하단 기준인지 좌상단 기준인지 주의. 보통 GL은 좌하단)
    vec2 tileOffset = vec2(col, row) * tileScale;
    
    // parabCoords [-1, 1] -> [0, 1]로 변환 후 타일 안에 배치
    vec2 uv = tileOffset + (parabCoords * 0.5 + 0.5) * tileScale;
    
    // ISM 깊이 값 샘플링
    float storedDist = textureLod(ismAtlas, uv, 0.0).r;             // .r 채널에 거리 저장됨
    
    // 그림자 비교 (Bias 적용)
    // 저장된 거리(storedDist)가 현재 거리(dist)보다 작으면 가려진 것
    float bias = 0.05; // 거리에 따라 조절 필요할 수 있음
    if (storedDist < dist - bias) return 0.0; // Shadowed
    
    return 1.0; // Visible
}


// *************** Direct ISM *********************
float getDirectVisibility(vec3 P, vec3 N) {
    // 1. World Position -> Light View Space 변환
    // main.cpp에서 설정한 lightView 행렬을 그대로 사용하므로 좌표축이 완벽히 일치합니다.
    vec4 viewPos4 = shadowViewMat * vec4(P, 1.0);
    vec3 viewPos = viewPos4.xyz;
    
    float dist = length(viewPos);
    
    // 2. 앞면/뒷면 판별 (Z축 기준)
    // OpenGL View Space에서는 -Z가 "앞(Front)", +Z가 "뒤(Back)"입니다.
    vec3 localPos = viewPos;
    float uOffset = 0.0;

    if (viewPos.z < 0.0) {
        // [Front Hemisphere] (카메라가 보는 방향)
        // Paraboloid 투영 공식은 +Z를 깊이 축으로 가정하므로 부호를 뒤집어줍니다.
        localPos.z = -localPos.z;
        uOffset = 0.0; // 텍스처의 왼쪽 절반 사용
    } else {
        // [Back Hemisphere] (카메라 등 뒤)
        // 이미 +Z 방향이므로 그대로 사용합니다.
        localPos.z = localPos.z;

        localPos.x = -localPos.x;

        uOffset = 0.5; // 텍스처의 오른쪽 절반 사용
    }

    // 3. Parabolic Projection
    // 공식: (x, y) / (dist + z)
    vec2 parabCoords = localPos.xy / (dist + localPos.z); 


    //parabCoords.y = -parabCoords.y;



    // 4. UV 매핑
    // parabCoords 범위 [-1, 1]을 [0, 0.5] 범위로 축소하고 오프셋을 더함
    vec2 uv;
    uv.x = uOffset + (parabCoords.x * 0.5 + 0.5) * 0.5;
    uv.y = parabCoords.y * 0.5 + 0.5;

    // 5. ISM 텍스처 샘플링 & 비교
    float storedDist = texture(directIsmTex, uv).r;

    // Bias 적용 (Direct ISM 해상도가 2048로 크므로 Bias를 조금 넉넉히 주거나 조절 필요)
    // 씬 스케일에 따라 0.05 ~ 0.2 사이 값으로 튜닝하세요.
    if (storedDist < dist - 0.01) return 0.0; // Shadowed

    return 1.0; // Visible
}







void main() {

    
    // ================= 2. Indirect Light 연산 ===================

    vec3 indirectLight = vec3(0);

    if (showIndirect > 0) {

        // 1. 4x4 패턴 정의
        int patternSize = 4; 
        int numPixels = patternSize * patternSize; // 16

        // 2. 현재 픽셀의 패턴 인덱스 계산 (0 ~ 15)
        // gl_FragCoord는 화면 좌표 (0.5, 0.5, ...)
        int x = int(gl_FragCoord.x ) % patternSize;
        int y = int(gl_FragCoord.y ) % patternSize;
        int offset = y * patternSize + x; // 0 ~ 15 사이의 값


        // 2. 간접 조명 계산 (ISM)
        float fNumVPLs = max(1.0, float(numVPLs));
        vec3 V = w_o;


        // (A) Diffuse Term (Lambertian)
        vec3 diffuseTerm = albedo.rgb / PI; 


        // 모든 VPL 순회
        // [Loop 시작] 0 ~ numVPLs 대신 startIdx ~ endIdx 사용
        for(int i = offset ; i < numVPLs ; i += numPixels) {
            // 1. VPL 정보 가져오기
            // vpls 구조체의 padding 때문에 .xyz로 확실하게 캐스팅
            vec3 vplPos = vpls[i].pos.xyz;
            vec3 vplN   = normalize(vpls[i].norm.xyz);
            vec3 vplFlux = vpls[i].color.rgb; // 빛의 세기(Color)

            // 무효 VPL(검은색)이면 스킵 (성능 최적화)
            if (dot(vplFlux, vplFlux) < 0.0001) continue;

            vec3 L = vplPos - worldPos;
            float dist2_vpl = dot(L, L);

            if (dist2_vpl < 0.0001) continue;
            float dist_vpl = sqrt(dist2_vpl);
            L /= dist_vpl; // Normalize L

            // 2. 기하학적 감쇠 (Geometric Terms)
            // VPL 표면의 코사인 (광원이 표면을 향하는지)
            float vplCos = max(0.0, dot(vplN, -L));
            // 받는 표면의 코사인 (표면이 광원을 향하는지)
            float surfCos = max(0.0, dot(N, L));
    
            // 서로 등지고 있으면 계산할 필요 없음
            if (vplCos <= 0.0 || surfCos <= 0.0) continue;

            // 3. 가시성 체크 (ISM Shadow)
            float vis = getVisibility(i, worldPos, N);
            if (vis <= 0.0) continue;

            // 4. 거리 감쇠 (Singularity 방지)
            float atten = 1.0 / max(0.1, dist2_vpl); 

            // ---------------------------------------------------------
            // [핵심] BRDF 적용 (Diffuse + Specular)
            // ---------------------------------------------------------
            vec3 H = normalize(L + V); // Half vector
    
            // (B) Specular Term (Cook-Torrance)
            // distGGX, geomSmithSchlick, FresnelSchlick
            float D = distGGX(N, H, roughness);       
            float G = geomSmithSchlick(L, V, H, roughness);      
            vec3 F = FresnelSchlick(V, H, surfaceF0); 

    
            vec3 numerator = D * G * F;
            float denominator = 4.0 * max(dot(N, V), 0.0) * surfCos + 0.05; 
            vec3 specularTerm = numerator / denominator;

            // (C) 에너지 보존 법칙 (Fresnel 기반 kS, kD 분배)
            vec3 kS = F;
            vec3 kD = vec3(1.0) - kS;
            kD *= (1.0 - metalness); // 금속성 높으면 Diffuse 감소

            // 최종 BRDF 합산
            vec3 brdf = (kD * diffuseTerm + specularTerm);
    
            // 최종 기여도 누적:
            // (VPL Flux) * (BRDF) * (표면Cos) * (VPL방출Cos) * (거리감쇠) * (가시성)
            indirectLight += (brdf * vplFlux) * (surfCos * vplCos * atten * vis);

            float maxVplBrightness = 1000.0;
            indirectLight = min(indirectLight, vec3(maxVplBrightness));
        }

        indirectLight *= float(numPixels);

        // 강도 조절 (전체적으로 너무 밝거나 어두울 수 있음)
        float indirectIntensity = 40;                         // 이 값을 50~200 사이로 조절
        indirectLight = (indirectLight / fNumVPLs) * indirectIntensity / 100;


        //color.rgb += indirectLight;

        //outColor = vec4(tonemap(color.rgb,mat3(1),2.4),color.a);

        // 혹시라도 NaN이 발생했다면 검정색(0)으로 덮어씀 (방어 코드)
        if (isnan(indirectLight.x) || isnan(indirectLight.y) || isnan(indirectLight.z)) {
            indirectLight = vec3(0.0);
        }
    }

    //outDirect = vec4(tonemap(directResult, mat3(1), 2.4), albedo.a);

    // 2. Indirect Light (노이즈 있음) -> 톤매핑은 블러 후에 하는게 좋지만 일단 여기서
    // (만약 HDR 블러를 원하면 톤매핑 빼고 저장)
    outIndirect = vec4(indirectLight, 1.0); 
    
    // 3. Normal (블러 가이드용) -> 0~1 범위로 압축해서 저장
    outNormal = vec4(N * 0.5 + 0.5, 1.0);
 

}  

