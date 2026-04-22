#version 410 core

uniform sampler2D uHighRes; // 현재 레벨 (구멍이 있는 상태)
uniform sampler2D uLowRes;  // 더 거친 레벨 (구멍이 어느 정도 메워진 상태)
uniform int uLevel;         // 현재 레벨 인덱스

in vec2 texCoord;
out vec4 outColor;

void main() {
// 1. ismTemp에서 현재 값(구멍 난 상태)을 읽음
    float currentDepth = textureLod(uHighRes, texCoord, float(uLevel)).r;
    
    float finalDepth = currentDepth;

    // 2. 구멍(1000.0)인지 확인
    // (주의: 피드백 루프가 해결되었으므로 이제 1000.0으로 정확히 읽힐 것임)
    if (currentDepth > 0.99) {
        // 구멍이면 L1(uLowRes)에서 보간된 값을 가져옴
        // uLowRes는 Mipmap 필터링이 켜진 ismAtlas이므로 자동으로 보간됨
        finalDepth = textureLod(uLowRes, texCoord, float(uLevel + 1)).r;
    } 
    if (finalDepth > 0.99) {
        // [수정] 배경(메워지지 않은 구멍 포함)은 흰색으로 출력 (OFF 상태와 동일하게)
        outColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
    
    // 3. 색상 출력 (ism.frag와 동일한 포맷: R=Depth, G=Depth^2)
    // 이렇게 하면 Pull-Push 전후 색감이 비슷해져서 비교하기 좋습니다.
    else 
        outColor = vec4(finalDepth, finalDepth * finalDepth, 0.0, 1.0);
}

    


/*
#version 410 core

uniform sampler2D uHighRes;
uniform sampler2D uLowRes;
uniform int uLevel;

in vec2 texCoord;
out vec4 outColor;

void main() {
    // 현재 레벨 값 읽기
    vec4 highVal = textureLod(uHighRes, texCoord, float(uLevel));
    float highDepth = highVal.r;

    // 1. 이미 데이터가 있거나(원본), 이미 메워진 경우(색상 존재)
    if (highDepth < 0.99) {
        outColor = highVal; // 그대로 유지
        return;
    }

    // 2. 구멍이라면 상위 레벨 확인
    vec4 lowVal = textureLod(uLowRes, texCoord, float(uLevel + 1));
    float lowDepth = lowVal.r;

    if (lowDepth < 0.99) {
        // [성공] 상위 레벨에서 데이터를 가져옴 -> 레벨별 색상 부여!
        
        // 만약 상위 레벨도 이미 색칠된 데이터라면? 그 색 유지 (전파)
        if (lowVal.g > 0.0 || lowVal.b > 0.0) {
             outColor = lowVal;
        } 
        else {
             // 상위 레벨이 '원본' 데이터였다면, 이번 단계(uLevel+1)가 최초 기여한 것임.
             if (uLevel == 0)      outColor = vec4(0.0, 1.0, 0.0, 1.0); // L1 기여 (Green)
             else if (uLevel == 1) outColor = vec4(0.0, 0.0, 1.0, 1.0); // L2 기여 (Blue)
             else if (uLevel == 2) outColor = vec4(1.0, 1.0, 0.0, 1.0); // L3 기여 (Yellow)
             else                  outColor = vec4(1.0, 0.0, 1.0, 1.0); // L4 기여 (Magenta)
        }
    } else {
        // [실패] 여전히 구멍
        outColor = vec4(1.0, 1.0, 1.0, 1.0); // Red
    }
}

*/
 

