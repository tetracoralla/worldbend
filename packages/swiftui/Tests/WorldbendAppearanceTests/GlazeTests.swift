import Foundation
import Testing
@testable import WorldbendAppearance

struct GlazeTests {
    @Test func recipeRoundTripsAndRejectsInvalidAuthoredValuesAsAWhole() throws {
        let recipe = WorldbendGlazeRecipe(bevelWidth: 9, coat: 0.8, roughness: 0.16, curvature: 0.6, pooling: 0.3)
        #expect(recipe.isValid)
        #expect(try JSONDecoder().decode(WorldbendGlazeRecipe.self, from: JSONEncoder().encode(recipe)) == recipe)
        for value in [Double.nan, .infinity, -1, 1.01] {
            var invalid = recipe; invalid.coat = value
            #expect(!invalid.isValid && invalid.effective == WorldbendGlazeRecipe())
        }
        var invalid = recipe; invalid.roughness = 0
        #expect(!invalid.isValid)
        invalid = recipe; invalid.bevelWidth = 25
        #expect(!invalid.isValid)
        for value in [Double.nan, .infinity, -0.01, 1.01] {
            invalid = recipe; invalid.coverage = value
            #expect(!invalid.isValid && invalid.effective == WorldbendGlazeRecipe())
        }
    }
    @Test func oldOpaqueRecipeRemainsOpaqueAndCoverageRoundTrips() throws {
        let data = Data(#"{"bevelWidth":4,"coat":1,"roughness":0.22,"curvature":0.8,"pooling":0.06}"#.utf8)
        #expect(try JSONDecoder().decode(WorldbendGlazeRecipe.self, from: data).coverage == 1)
        let recipe = WorldbendGlazeRecipe(coverage: 0.88)
        #expect(try JSONDecoder().decode(WorldbendGlazeRecipe.self, from: JSONEncoder().encode(recipe)) == recipe)
    }
}
