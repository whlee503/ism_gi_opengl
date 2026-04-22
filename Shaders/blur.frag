#version 430 core

out vec4 outColor;
in vec2 texCoord;

uniform sampler2D noisyTex; // 모기장 있는 간접광 (Color 1)
uniform sampler2D normalTex; // 화면의 법선 텍스처 (Color 2)
uniform sampler2D depthTex;  // 깊이 텍스처 (Depth Attachment)
uniform sampler2D directTex;

uniform vec2 resolution;     // 화면 해상도 (1600, 1200)

// 블러 설정
const int KERNEL_RADIUS = 3; // 3이면 7x7, 5면 11x11
const float SIGMA_SPATIAL = 4.0; // 공간적 거리 가중치
const float SIGMA_NORMAL  = 0.5; // 법선 차이 민감도 (작을수록 예민)
const float SIGMA_DEPTH   = 0.1; // 깊이 차이 민감도 (작을수록 예민)

float gaussian(float x, float sigma) {
    return exp(-(x*x) / (2.0 * sigma * sigma));
}

// [추가] 톤매핑 함수 복사 (render.frag에 있던 것)
float tonemap_sRGB(float u) {
    float u_ = abs(u);
    return u_ > 0.0031308 ? (sign(u) * 1.055 * pow(u_, 0.41667) - 0.055) : (12.92 * u);
}
vec3 tonemap(vec3 rgb, float gamma) {
    // 간단하게 sRGB 감마 보정만 적용해도 충분합니다.
    vec3 rgb_ = rgb;
    if (abs(gamma - 2.4) < 0.01)
        return vec3(tonemap_sRGB(rgb_.r), tonemap_sRGB(rgb_.g), tonemap_sRGB(rgb_.b));
    return sign(rgb_) * pow(abs(rgb_), vec3(1.0/gamma));
}


void main() {
    vec2 centerUV = texCoord;
    
    // 중심 픽셀 정보 읽기
    vec3 centerColor = texture(noisyTex, centerUV).rgb;
    vec3 centerNormal = texture(normalTex, centerUV).xyz * 2.0 - 1.0;
    float centerDepth = texture(depthTex, centerUV).r;

    // 만약 배경(깊이 1.0)이라면 블러 안함
    if(centerDepth >= 1.0) {
        outColor = vec4(centerColor, 1.0);
        return;
    }

    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;

    // 주변 픽셀 순회 (Box Blur 형태지만 가중치는 Bilateral)
    for (int x = -KERNEL_RADIUS; x <= KERNEL_RADIUS; ++x) {
        for (int y = -KERNEL_RADIUS; y <= KERNEL_RADIUS; ++y) {
            
            vec2 offset = vec2(float(x), float(y));
            vec2 neighborUV = centerUV + offset / resolution;

            // 주변 픽셀 정보 읽기
            vec3 neighborColor = texture(noisyTex, neighborUV).rgb;
            vec3 neighborNormal = texture(normalTex, neighborUV).xyz * 2.0 - 1.0; // [수정] 여기도 Decoding
            float neighborDepth = texture(depthTex, neighborUV).r;

            // 1. Spatial Weight (거리가 멀수록 가중치 감소)
            float wSpatial = gaussian(length(offset), SIGMA_SPATIAL);

            // 2. Normal Weight (법선이 다르면 가중치 급격히 감소 -> 모서리 보존)
            float wNormal = pow(max(0.0, dot(centerNormal, neighborNormal)), 32.0); 

            // 3. Depth Weight (깊이가 다르면 가중치 감소 -> 앞뒤 물체 구분)
            // 선형 깊이가 아니라서 약간 부정확하지만, 작은 차이에는 효과적
            float diffDepth = abs(centerDepth - neighborDepth) * 100.0; // 스케일 조정 필요
            float wDepth = exp(-diffDepth);

            // 최종 가중치
            float weight = wSpatial * wNormal * wDepth;

            sumColor += neighborColor * weight;
            sumWeight += weight;
        }
    }

    // 블러된 간접광 결과 (Linear)
    vec3 blurredIndirect = sumColor / max(sumWeight, 0.0001);
    
    // [추가] 직접광 읽기 (Linear)
    vec3 directLight = texture(directTex, texCoord).rgb;
    
    // [핵심] Linear 공간에서 합치기
    vec3 finalColor = directLight + blurredIndirect;
    
    // [핵심] 마지막에 톤매핑 (Gamma Correction)
    outColor = vec4(tonemap(finalColor, 2.4), 1.0);
    //outColor = vec4(finalColor, 1.0);


    //// 결과 정규화
    //outColor = vec4(sumColor / max(sumWeight, 0.0001), 1.0);
}