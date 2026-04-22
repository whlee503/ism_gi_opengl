#version 430 core

// [SSBO 정의]
struct VPL {
    vec4 pos;
    vec4 norm;
    vec4 color;
};
layout(std430, binding = 0) buffer VPLBuffer {
    VPL vpls[];
};

struct Point {
    vec4 pos;
    vec4 norm;
};
layout(std430, binding = 1) buffer PointBuffer {
    Point globalPoints[];
};

// [Uniforms]
uniform int totalPoints;      // 전체 포인트 개수 (예: 256,000)
uniform int gridCols;         // 아틀라스 가로 타일 개수
uniform int gridRows;         // 아틀라스 세로 타일 개수
uniform int isDirectPass;     // 0: Indirect(VPL), 1: Direct
uniform mat4 directLightViewMat; // Direct Pass용 View Matrix
uniform int uDualPass;        // Direct Pass용 (0: Front, 1: Back)
uniform mat4 modelMat; // [추가] main.cpp에서 dynamicModelMat을 받음

out float vDepth; // Fragment Shader로 깊이 값 전달

void main() {
    vec3 worldPos;
    vec3 worldNorm;

    // =============================================================
    // 1. 데이터 가져오기 (Random Subset Logic)
    // =============================================================
    if (isDirectPass == 0) {
        // [Indirect Mode]
        // VPL ID와 Vertex ID를 조합하여 전체 포인트 풀에서 "랜덤하게" 가져옴
        uint hugePrime = 104729u; // 큰 소수
        uint vplShift  = uint(gl_InstanceID) * 12347u; // VPL마다 다른 시작점
        
        // VertexID에 소수를 곱하는 것이 핵심! (데이터를 껑충껑충 건너뜀)
        uint idx = (vplShift + uint(gl_VertexID) * hugePrime) % uint(totalPoints);
        
        worldPos  = globalPoints[idx].pos.xyz;
        worldNorm = globalPoints[idx].norm.xyz;
        worldPos  = globalPoints[idx].pos.xyz;
        worldNorm = globalPoints[idx].norm.xyz;
    } 
    else {
        // [Direct Mode]
        // 전체 포인트를 순차적으로 가져오거나, 동일한 랜덤 로직 사용 가능
        // 여기서는 그냥 순서대로 가져옴
        uint idx = uint(gl_VertexID) % uint(totalPoints);
        worldPos  = globalPoints[idx].pos.xyz;
        worldNorm = globalPoints[idx].norm.xyz;
    }

    // [★추가] 포인트 위치 이동 (Model Matrix 적용)
    // globalPoints는 이미 초기 transform이 적용된 상태이므로 동적 이동만 적용
    worldPos  = (modelMat * vec4(worldPos, 1.0)).xyz;
    worldNorm = normalize((modelMat * vec4(worldNorm, 0.0)).xyz); // 회전 적용

    // =============================================================
    // 2. 광원 기준 좌표계 변환 (World Space -> Light View Space)
    // =============================================================
    vec3 localPos; // 광원 기준 위치 (Light View Space)
    float dist;    // 광원과의 거리

    if (isDirectPass == 1) {
        // [Direct Pass] 행렬 이용
        vec4 viewPos = directLightViewMat * vec4(worldPos, 1.0);
        localPos = viewPos.xyz;
        
        // Direct Light의 "깊이" 방향 처리 (Dual Paraboloid)
        if (uDualPass == 0) localPos.z = -localPos.z; // Front
        else                localPos.z =  localPos.z; // Back
        
        dist = length(localPos);
    } 
    else {
        // [Indirect Pass] VPL 정보 이용
        int vplIdx = gl_InstanceID;
        vec3 lightPos = vpls[vplIdx].pos.xyz;
        vec3 rawNorm  = vpls[vplIdx].norm.xyz; // 정규화 전 원본 데이터 가져오기
        vec3 lightDir;

        // [핵심 수정] 법선 데이터가 깨져있거나(0,0,0), NaN인 경우 방어
        if (length(rawNorm) < 0.001) {
            // 잘못된 VPL은 강제로 '천장 조명'처럼 취급하여 살려냄 (디버깅 및 방어)
            lightDir = vec3(0, -1, 0); 
        } else {
            lightDir = normalize(rawNorm);
        }

        // 1) 광원까지의 벡터 및 거리 계산
        vec3 diff = worldPos - lightPos;
        dist = length(diff);

        // [추가 방어] 만약 VPL 위치 자체가 (0,0,0)이라서 dist가 이상해지는 경우 방지
        if (dist < 0.001) {
             gl_Position = vec4(0, 0, 0, 0);
             return;
        }

        // -----------------------------------------------------
        // [핵심] 뒷면 제거 (Backface Culling)
        // 점의 법선(worldNorm)과 빛의 방향(diff)이 같은 방향을 보면(=내적 > 0)
        // 빛을 등지고 있다는 뜻이므로 그리지 않음.
        // -----------------------------------------------------
        if (dot(worldNorm, diff) > 0.0) {
             gl_Position = vec4(0, 0, 0, 0); // 버림
             return;
        }
        
        // 2) VPL 기준의 Basis(축) 생성
        vec3 up = vec3(0, 1, 0);
        if (abs(lightDir.y) > 0.99) up = vec3(1, 0, 0); // 특이점 방지
        
        vec3 right = normalize(cross(up, lightDir));
        up = normalize(cross(lightDir, right));

        // 3) 회전 변환 (수동 내적) -> Local View Space 좌표 구함
        localPos.x = dot(diff, right);
        localPos.y = dot(diff, up);
        localPos.z = dot(diff, lightDir);
    }

    vDepth = dist; // 깊이 값 저장

    // =============================================================
    // 3. Paraboloid 투영 (반구 투영)
    // =============================================================
    // z값이 음수면 광원 뒤쪽에 있는 것이므로 버림
    if (localPos.z < 0.001) { 
        gl_Position = vec4(0, 0, 0, 0);
        return;
    }

    // Parabolic Projection 공식
    // (x, y)를 거리(dist)와 깊이(z)의 합으로 나눔
    vec2 parabCoords = localPos.xy / (dist + localPos.z);


    // =============================================================
    // 4. 아틀라스 타일링 및 위치 결정
    // =============================================================
    if (isDirectPass == 1) {
        // [Direct] 전체 화면 사용
        gl_Position = vec4(parabCoords, 0.0, 1.0);
        
        // 점 크기 설정 (Direct는 해상도가 높으므로 작게)
        float directScale = 0.15; 
        float splatSize = directScale / (dist * dist + 0.0001);
        gl_PointSize = clamp(splatSize, 1.0, 64.0);
    } 
    else {
        // [Indirect] 아틀라스 내의 해당 VPL 타일 위치 계산
        int vplIdx = gl_InstanceID;
        int col = vplIdx % gridCols;
        int row = vplIdx / gridCols;
        
        // 타일 하나의 크기 (NDC 기준 -1 ~ 1 이므로 전체 폭은 2.0)
        float tileW = 2.0 / float(gridCols);
        float tileH = 2.0 / float(gridRows);
        
        // 타일의 중심 좌표
        float centerX = -1.0 + (float(col) + 0.5) * tileW;
        float centerY = -1.0 + (float(row) + 0.5) * tileH;
        
        // 최종 위치: 타일 중심 + (투영좌표 * 타일크기/2)
        vec2 finalPos = vec2(centerX, centerY) + parabCoords * vec2(tileW, tileH) * 0.5;
        
        gl_Position = vec4(finalPos, 0.0, 1.0);

        // [점 크기 설정]
        // 멀리 있는 점은 작게, 가까운 점은 크게 (빈틈 메우기)
        // [사용자 최적값]
        float vplScale = .3f; 
        float splatSize = vplScale / (dist * dist + 0.001);
        gl_PointSize = clamp(splatSize, 1.0, 12.0);
    }
}




/*

void main() {
    vec3 lightPos;
    vec3 lightDir;

    // 1. 모드에 따른 광원 정보
    if (isDirectPass == 1) {
        lightPos = directLightPos;
        lightDir = normalize(directLightDir);
    } else {
        int vplIdx = gl_InstanceID;
        lightPos = vplPos[vplIdx];
        lightDir = normalize(vplNorm[vplIdx]);
    }

    // 2. View Space 변환 (LookAt 로직을 쉐이더에서 수행)
    vec3 worldPos = inPosition;
    vec3 diff = worldPos - lightPos;
    float dist = length(diff);
    
    // 깊이 값 저장 (거리를 저장)
    vDepth = dist;

    // View Basis 구성 (VPL Normal을 Z축으로)
    vec3 up = vec3(0, 1, 0);
    if (abs(lightDir.y) > 0.99) up = vec3(1, 0, 0); // 특이점 방지
    vec3 right = normalize(cross(up, lightDir));
    up = cross(lightDir, right);
    
    // VPL 기준 로컬 좌표계로 변환 (Rotation)
    vec3 localPos;
    localPos.x = dot(diff, right);
    localPos.y = dot(diff, up);
    localPos.z = dot(diff, lightDir);

    // 3. Parabolic Projection (반구 투영)
    // Parabolic Map 공식: z = dist, (x, y) = (x, y) / (z + local_z)
    // 뒷면(반구 뒤쪽)에 있는 점은 버림
    if (localPos.z < -dist * 0.1) {
        gl_Position = vec4(0, 0, 0, 0); // 렌더링 무효화
        return;
    }
    
    vec2 parabCoords = localPos.xy / (dist + localPos.z);
    // 이제 parabCoords는 [-1, 1] 범위입니다.



    // 3. 모드별 처리 & 스케일 조정
    if (isDirectPass == 1) {
        // [Direct Mode] 전체 화면 사용 (Left or Right는 뷰포트로 제어됨)
        gl_Position = vec4(parabCoords, 0.0, 1.0);
        
        // [스케일 조정]
        // 해상도가 128 -> 1024로 8배 커짐 -> 면적은 64배 -> 점 지름은 약 8~16배 커져야 함
        // 사용자 최적값 0.12 * 16 = 약 2.0 (조정 필요)
        float directScale = 0.01; 
        
        float splatSize = directScale / (dist * dist + 0.001);
        gl_PointSize = clamp(splatSize, 64.0, 64.0);
    } 
    else {
        // [VPL Mode] 아틀라스 타일링
        int vplIdx = gl_InstanceID;
        int col = vplIdx % gridCols;
        int row = vplIdx / gridCols;
        float tileW = 2.0 / float(gridCols);
        float tileH = 2.0 / float(gridRows);
        float centerX = -1.0 + (float(col) + 0.5) * tileW;
        float centerY = -1.0 + (float(row) + 0.5) * tileH;
        vec2 finalPos = vec2(centerX, centerY) + parabCoords * vec2(tileW, tileH) * 0.5;
        
        gl_Position = vec4(finalPos, 0.0, 1.0);
        
        // [사용자 최적값]
        float vplScale = 4.0; 
        float splatSize = vplScale / (dist * dist + 0.001);
        gl_PointSize = clamp(splatSize, 3.0, 32.0);
    }
}

*/