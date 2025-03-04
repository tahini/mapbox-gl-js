// @flow

import StencilMode from '../gl/stencil_mode.js';
import DepthMode from '../gl/depth_mode.js';
import CullFaceMode from '../gl/cull_face_mode.js';
import Program from './program.js';
import {circleUniformValues, circleDefinesValues} from './program/circle_program.js';
import SegmentVector from '../data/segment.js';
import {OverscaledTileID} from '../source/tile_id.js';

import type Painter from './painter.js';
import type SourceCache from '../source/source_cache.js';
import type CircleStyleLayer from '../style/style_layer/circle_style_layer.js';
import type CircleBucket from '../data/bucket/circle_bucket.js';
import type ProgramConfiguration from '../data/program_configuration.js';
import type VertexBuffer from '../gl/vertex_buffer.js';
import type IndexBuffer from '../gl/index_buffer.js';
import type {UniformValues} from './uniform_binding.js';
import type {CircleUniformsType} from './program/circle_program.js';
import type Tile from '../source/tile.js';
import type {DynamicDefinesType} from './program/program_uniforms.js';

export default drawCircles;

type TileRenderState = {
    programConfiguration: ProgramConfiguration,
    program: Program<*>,
    layoutVertexBuffer: VertexBuffer,
    indexBuffer: IndexBuffer,
    uniformValues: UniformValues<CircleUniformsType>,
    tile: Tile
};

type SegmentsTileRenderState = {
    segments: SegmentVector,
    sortKey: number,
    state: TileRenderState
};

function drawCircles(painter: Painter, sourceCache: SourceCache, layer: CircleStyleLayer, coords: Array<OverscaledTileID>) {
    if (painter.renderPass !== 'translucent') return;

    const opacity = layer.paint.get('circle-opacity');
    const strokeWidth = layer.paint.get('circle-stroke-width');
    const strokeOpacity = layer.paint.get('circle-stroke-opacity');
    const sortFeaturesByKey = layer.layout.get('circle-sort-key').constantOr(1) !== undefined;

    if (opacity.constantOr(1) === 0 && (strokeWidth.constantOr(1) === 0 || strokeOpacity.constantOr(1) === 0)) {
        return;
    }

    const context = painter.context;
    const gl = context.gl;

    const depthMode = painter.depthModeForSublayer(0, DepthMode.ReadOnly);
    // Turn off stencil testing to allow circles to be drawn across boundaries,
    // so that large circles are not clipped to tiles
    const stencilMode = StencilMode.disabled;
    const colorMode = painter.colorModeForRenderPass();

    const segmentsRenderStates: Array<SegmentsTileRenderState> = [];

    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];

        const tile = sourceCache.getTile(coord);
        const bucket: ?CircleBucket<*> = (tile.getBucket(layer): any);
        if (!bucket) continue;

        const programConfiguration = bucket.programConfigurations.get(layer.id);
        const definesValues = circleDefinesValues(layer);
        const program = painter.useProgram('circle', programConfiguration, layer.customShader, ((definesValues: any): DynamicDefinesType[]));
        const layoutVertexBuffer = bucket.layoutVertexBuffer;
        const indexBuffer = bucket.indexBuffer;
        const uniformValues = circleUniformValues(painter, coord, tile, layer);

        const state: TileRenderState = {
            programConfiguration,
            program,
            layoutVertexBuffer,
            indexBuffer,
            uniformValues,
            tile
        };

        if (sortFeaturesByKey) {
            const oldSegments = bucket.segments.get();
            for (const segment of oldSegments) {
                segmentsRenderStates.push({
                    segments: new SegmentVector([segment]),
                    sortKey: ((segment.sortKey: any): number),
                    state
                });
            }
        } else {
            segmentsRenderStates.push({
                segments: bucket.segments,
                sortKey: 0,
                state
            });
        }

    }

    if (sortFeaturesByKey) {
        segmentsRenderStates.sort((a, b) => a.sortKey - b.sortKey);
    }

    for (const segmentsState of segmentsRenderStates) {
        const {programConfiguration, program, layoutVertexBuffer, indexBuffer, uniformValues, tile} = segmentsState.state;
        const segments = segmentsState.segments;
        if (painter.terrain) painter.terrain.setupElevationDraw(tile, program, {useDepthForOcclusion: true});

        painter.prepareDrawProgram(context, program, tile.tileID.toUnwrapped());

        program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            uniformValues, layer.id,
            layoutVertexBuffer, indexBuffer, segments,
            layer.paint, painter.transform.zoom, programConfiguration);
    }
}
