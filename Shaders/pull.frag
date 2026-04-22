#version 410 core

uniform sampler2D uTex; // 이전 레벨
uniform int uLevel;     // 읽을 레벨

in vec2 texCoord;
out vec4 outColor;

void main() {
    ivec2 texSize = textureSize(uTex, uLevel);
    vec2 halfPixel = 0.5 / vec2(texSize);
    
    vec2 offsets[4] = vec2[](
        vec2(-halfPixel.x, -halfPixel.y),
        vec2( halfPixel.x, -halfPixel.y),
        vec2(-halfPixel.x,  halfPixel.y),
        vec2( halfPixel.x,  halfPixel.y)
    );

    float minDepth = 1.0;
    // 1. 먼저 유효한 최소 깊이(가장 가까운 점)를 찾습니다.
    for(int i=0; i<4; i++) {
         float d = textureLod(uTex, texCoord + offsets[i], float(uLevel)).r;
         if(d < 0.99) minDepth = min(minDepth, d);
    }

    vec2 sum = vec2(0.0);
    float weight = 0.0;
    
    // 논문 권장 Threshold: 씬 크기의 약 5% (조절 필요)
    // 레벨이 올라갈수록 허용 오차를 2배씩 늘려줍니다.
    float threshold = 0.02 * pow(2.0, float(uLevel)); 

    for(int i=0; i<4; i++) {
        vec2 val = textureLod(uTex, texCoord + offsets[i], float(uLevel)).rg;
        
        // [수정] 유효성 체크 + 깊이 차이 체크 (Outlier Rejection)
        if(val.r < 0.99 && abs(val.r - minDepth) < threshold) {
            sum += val;
            weight += 1.0;
        }
    }

    if(weight > 0.0) {
        // [수정 3] 평균값 출력 (Green 채널 데이터 보존!)
        outColor = vec4(sum / weight, 0, 1);
    } else {
        // [수정 4] 구멍일 때 빨간색(1,0,0)이 아니라 흰색(1,1,1)으로 채움
        // 그래야 배경(무한대 거리)으로 인식됨. (R=1, G=1)
        outColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
}